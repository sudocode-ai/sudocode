#!/usr/bin/env python3
"""
Kokoro TTS Sidecar

A JSON-lines protocol sidecar for streaming text-to-speech generation
using Kokoro-ONNX with native GPU acceleration.

Protocol (stdin/stdout JSON-lines):
  Requests:
    - Generate: {"id": "req-123", "type": "generate", "text": "Hello", "voice": "af_heart", "speed": 1.0}
    - Ping: {"id": "health", "type": "ping"}
    - Shutdown: {"type": "shutdown"}

  Responses:
    - Ready: {"id": "init", "type": "ready"}
    - Audio: {"id": "req-123", "type": "audio", "chunk": "<base64 PCM>", "index": 0}
    - Done: {"id": "req-123", "type": "done", "total_chunks": 1}
    - Error: {"id": "req-123", "type": "error", "error": "message", "recoverable": true}
    - Pong: {"id": "health", "type": "pong"}

Audio Format: mono, 24kHz, float32 PCM (base64 encoded)
"""

import base64
import json
import os
import re
import sys
from pathlib import Path
from typing import Generator, Optional, Any

# Lazy-loaded globals
_kokoro: Optional[Any] = None
_sample_rate: int = 24000

# Model file names (downloaded by sidecar manager)
MODEL_FILENAME = "kokoro-v1.0.onnx"
VOICES_FILENAME = "voices-v1.0.bin"

# Constants for text chunking
MIN_CHUNK_SIZE = 20
MAX_SENTENCE_LENGTH = 150


def log(message: str, level: str = "INFO") -> None:
    """
    Log a message to stderr.

    All logging goes to stderr to keep stdout clean for the JSON protocol.

    Args:
        message: The message to log
        level: Log level (INFO, WARN, ERROR, DEBUG)
    """
    print(f"[kokoro-sidecar] [{level}] {message}", file=sys.stderr, flush=True)


def send_response(response: dict) -> None:
    """
    Send a JSON response to stdout.

    Args:
        response: Dictionary to serialize and send
    """
    print(json.dumps(response), flush=True)


def get_models_dir() -> Path:
    """
    Get the directory containing Kokoro model files.

    Checks in order:
    1. KOKORO_MODELS_DIR environment variable
    2. Default: ~/.config/sudocode/tts/models/

    Returns:
        Path to models directory
    """
    env_dir = os.environ.get("KOKORO_MODELS_DIR")
    if env_dir:
        return Path(env_dir)

    # Default path (cross-platform)
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))

    return base / "sudocode" / "tts" / "models"


def load_model() -> bool:
    """
    Lazy-load the Kokoro TTS model.

    The model is loaded on first use rather than at startup to reduce
    memory usage when TTS is not needed.

    Model files are expected to be in the models directory:
    - kokoro-v1.0.onnx (neural network model)
    - voices-v1.0.bin (voice embeddings)

    Returns:
        True if model loaded successfully, False otherwise
    """
    global _kokoro, _sample_rate

    if _kokoro is not None:
        return True

    try:
        from kokoro_onnx import Kokoro

        models_dir = get_models_dir()
        model_path = models_dir / MODEL_FILENAME
        voices_path = models_dir / VOICES_FILENAME

        # Verify model files exist
        if not model_path.exists():
            log(f"Model file not found: {model_path}", "ERROR")
            return False

        if not voices_path.exists():
            log(f"Voices file not found: {voices_path}", "ERROR")
            return False

        log(f"Loading Kokoro model from {models_dir}...")

        # Initialize Kokoro with explicit model paths
        _kokoro = Kokoro(str(model_path), str(voices_path))

        log(f"Model loaded successfully, sample rate: {_sample_rate}")
        return True

    except ImportError as e:
        log(f"Failed to import kokoro_onnx: {e}", "ERROR")
        return False
    except Exception as e:
        log(f"Failed to load model: {e}", "ERROR")
        return False


def chunk_text(text: str) -> list[str]:
    """
    Split text into chunks using hybrid sentence + clause boundaries.

    Strategy:
    1. Split on sentence boundaries (. ! ?)
    2. For sentences > MAX_SENTENCE_LENGTH chars, split on clause boundaries (, ; : -)
    3. Preserve punctuation for natural prosody
    4. Minimum chunk size: MIN_CHUNK_SIZE chars (avoid micro-chunks)

    Args:
        text: The input text to chunk

    Returns:
        List of text chunks suitable for TTS generation
    """
    if not text or not text.strip():
        return []

    text = text.strip()

    # If text is short enough, return as single chunk
    if len(text) <= MAX_SENTENCE_LENGTH:
        return [text]

    chunks: list[str] = []

    # Step 1: Split on sentence boundaries, preserving punctuation
    # Match sentence-ending punctuation followed by space or end of string
    sentence_pattern = r'(?<=[.!?])\s+'
    sentences = re.split(sentence_pattern, text)

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        # Step 2: If sentence is too long, split on clause boundaries
        if len(sentence) > MAX_SENTENCE_LENGTH:
            clause_chunks = _split_on_clauses(sentence)
            chunks.extend(clause_chunks)
        else:
            # Avoid micro-chunks by merging with previous if too small
            if chunks and len(sentence) < MIN_CHUNK_SIZE:
                chunks[-1] = chunks[-1] + " " + sentence
            else:
                chunks.append(sentence)

    # Final pass: merge any remaining micro-chunks
    merged_chunks = _merge_small_chunks(chunks)

    return merged_chunks


def _split_on_clauses(sentence: str) -> list[str]:
    """
    Split a long sentence on clause boundaries.

    Clause boundaries: , ; : - (em dash)

    Args:
        sentence: A sentence that exceeds MAX_SENTENCE_LENGTH

    Returns:
        List of clause chunks
    """
    # Split on clause boundaries, keeping the delimiter with the preceding text
    # Use lookbehind to split after the punctuation
    clause_pattern = r'(?<=[,;:\u2014-])\s+'
    clauses = re.split(clause_pattern, sentence)

    result: list[str] = []
    current_chunk = ""

    for clause in clauses:
        clause = clause.strip()
        if not clause:
            continue

        # If adding this clause would exceed max length, save current and start new
        if current_chunk and len(current_chunk) + len(clause) + 1 > MAX_SENTENCE_LENGTH:
            result.append(current_chunk)
            current_chunk = clause
        else:
            if current_chunk:
                current_chunk += " " + clause
            else:
                current_chunk = clause

    if current_chunk:
        result.append(current_chunk)

    return result


def _merge_small_chunks(chunks: list[str]) -> list[str]:
    """
    Merge chunks that are smaller than MIN_CHUNK_SIZE with neighbors.

    Args:
        chunks: List of text chunks

    Returns:
        List with small chunks merged
    """
    if not chunks:
        return []

    result: list[str] = []

    for chunk in chunks:
        if not result:
            result.append(chunk)
        elif len(chunk) < MIN_CHUNK_SIZE:
            # Merge with previous chunk
            result[-1] = result[-1] + " " + chunk
        elif len(result[-1]) < MIN_CHUNK_SIZE:
            # Previous chunk is small, merge current into it
            result[-1] = result[-1] + " " + chunk
        else:
            result.append(chunk)

    return result


def generate_chunks(
    text: str,
    voice: str = "af_heart",
    speed: float = 1.0
) -> Generator[tuple[bytes, int], None, None]:
    """
    Generate audio chunks from text using Kokoro TTS.

    Yields PCM audio data (mono, 24kHz, float32) for each text chunk.

    Args:
        text: The text to synthesize
        voice: Voice identifier (e.g., "af_heart", "af_sarah")
        speed: Speech speed multiplier (1.0 = normal)

    Yields:
        Tuple of (pcm_bytes, chunk_index)

    Raises:
        RuntimeError: If model is not loaded
    """
    global _kokoro, _sample_rate

    if _kokoro is None:
        raise RuntimeError("Model not loaded")

    chunks = chunk_text(text)

    if not chunks:
        return

    for index, chunk in enumerate(chunks):
        try:
            # Generate audio samples using kokoro-onnx
            # Returns (samples: np.ndarray, sample_rate: int)
            samples, sr = _kokoro.create(
                chunk,
                voice=voice,
                speed=speed,
                lang="en-us"  # Default to English
            )

            # Ensure sample rate matches expected
            if sr != _sample_rate:
                log(f"Sample rate mismatch: expected {_sample_rate}, got {sr}", "WARN")
                _sample_rate = sr

            # Convert numpy array to bytes (float32)
            # samples is already float32 from kokoro-onnx
            pcm_bytes = samples.astype("float32").tobytes()

            yield (pcm_bytes, index)

        except Exception as e:
            log(f"Error generating chunk {index}: {e}", "ERROR")
            raise


def handle_generate(request: dict) -> None:
    """
    Handle a TTS generation request.

    Streams audio chunks back as they are generated.

    Args:
        request: The generation request with id, text, voice, speed
    """
    request_id = request.get("id", "unknown")
    text = request.get("text", "")
    voice = request.get("voice", "af_heart")
    speed = request.get("speed", 1.0)

    if not text:
        send_response({
            "id": request_id,
            "type": "error",
            "error": "No text provided",
            "recoverable": True
        })
        return

    # Ensure model is loaded
    if not load_model():
        send_response({
            "id": request_id,
            "type": "error",
            "error": "Failed to load TTS model",
            "recoverable": False
        })
        return

    try:
        total_chunks = 0

        for pcm_bytes, index in generate_chunks(text, voice, speed):
            # Encode PCM data as base64
            chunk_b64 = base64.b64encode(pcm_bytes).decode("ascii")

            send_response({
                "id": request_id,
                "type": "audio",
                "chunk": chunk_b64,
                "index": index
            })

            total_chunks = index + 1

        # Send completion message
        send_response({
            "id": request_id,
            "type": "done",
            "total_chunks": total_chunks
        })

    except Exception as e:
        log(f"Generation error: {e}", "ERROR")
        send_response({
            "id": request_id,
            "type": "error",
            "error": str(e),
            "recoverable": True
        })


def handle_request(request: dict) -> bool:
    """
    Route and handle an incoming request.

    Args:
        request: Parsed JSON request

    Returns:
        True to continue, False to shutdown
    """
    request_type = request.get("type", "")
    request_id = request.get("id", "")

    if request_type == "generate":
        handle_generate(request)
        return True

    elif request_type == "ping":
        send_response({
            "id": request_id or "health",
            "type": "pong"
        })
        return True

    elif request_type == "shutdown":
        log("Received shutdown request")
        return False

    else:
        send_response({
            "id": request_id or "unknown",
            "type": "error",
            "error": f"Unknown request type: {request_type}",
            "recoverable": True
        })
        return True


def main() -> None:
    """
    Main entry point for the sidecar.

    Reads JSON-lines from stdin and writes responses to stdout.
    """
    log("Kokoro TTS sidecar starting...")

    # Send ready signal
    send_response({
        "id": "init",
        "type": "ready"
    })

    log("Ready, waiting for requests...")

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
            except json.JSONDecodeError as e:
                log(f"Invalid JSON: {e}", "ERROR")
                send_response({
                    "id": "unknown",
                    "type": "error",
                    "error": f"Invalid JSON: {e}",
                    "recoverable": True
                })
                continue

            # Handle the request
            should_continue = handle_request(request)

            if not should_continue:
                break

    except KeyboardInterrupt:
        log("Interrupted by user")
    except Exception as e:
        log(f"Fatal error: {e}", "ERROR")
        send_response({
            "id": "fatal",
            "type": "error",
            "error": str(e),
            "recoverable": False
        })
    finally:
        log("Sidecar shutting down")


if __name__ == "__main__":
    main()
