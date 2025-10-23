/**
 * Operations for managing cross-references in markdown content
 */

export interface AddReferenceOptions {
  referenceId: string;
  displayText?: string;
  relationshipType?: string;
  format?: 'inline' | 'newline';
  position?: 'before' | 'after';
}

export interface ReferenceLocation {
  line?: number;
  text?: string;
}

/**
 * Format a reference string with optional display text and relationship type
 *
 * Examples:
 * - formatReference('issue-001') => '[[issue-001]]'
 * - formatReference('issue-001', 'OAuth') => '[[issue-001|OAuth]]'
 * - formatReference('issue-001', undefined, 'implements') => '[[issue-001]]{ implements }'
 * - formatReference('issue-001', 'OAuth', 'implements') => '[[issue-001|OAuth]]{ implements }'
 */
export function formatReference(
  referenceId: string,
  displayText?: string,
  relationshipType?: string
): string {
  let ref = `[[${referenceId}`;

  if (displayText) {
    ref += `|${displayText}`;
  }

  ref += ']]';

  if (relationshipType) {
    ref += `{ ${relationshipType} }`;
  }

  return ref;
}

/**
 * Find the character index for a given line number in content
 */
function getCharIndexForLine(content: string, lineNumber: number): number {
  const lines = content.split('\n');

  if (lineNumber < 1 || lineNumber > lines.length) {
    throw new Error(`Line number ${lineNumber} is out of bounds (content has ${lines.length} lines)`);
  }

  // Calculate character index at the start of the line
  let charIndex = 0;
  for (let i = 0; i < lineNumber - 1; i++) {
    charIndex += lines[i].length + 1; // +1 for newline
  }

  return charIndex;
}

/**
 * Find the character index for text in content
 */
function getCharIndexForText(content: string, searchText: string): number {
  const index = content.indexOf(searchText);

  if (index === -1) {
    throw new Error(`Text not found: "${searchText}"`);
  }

  return index;
}

/**
 * Add a reference to markdown content at the specified location
 *
 * @param content - The markdown content to modify
 * @param location - Where to insert the reference (line or text)
 * @param options - Reference formatting options
 * @returns Updated content with reference inserted
 */
export function addReferenceToContent(
  content: string,
  location: ReferenceLocation,
  options: AddReferenceOptions
): string {
  const { referenceId, displayText, relationshipType, format = 'inline', position = 'after' } = options;

  // Validate location
  if (!location.line && !location.text) {
    throw new Error('Either line or text must be specified');
  }

  if (location.line && location.text) {
    throw new Error('Cannot specify both line and text');
  }

  // Format the reference
  const refString = formatReference(referenceId, displayText, relationshipType);

  // Determine insertion point
  let insertIndex: number;

  if (location.line) {
    insertIndex = getCharIndexForLine(content, location.line);

    if (position === 'after') {
      // Move to end of line
      const lineEndIndex = content.indexOf('\n', insertIndex);
      insertIndex = lineEndIndex === -1 ? content.length : lineEndIndex;
    }
  } else if (location.text) {
    insertIndex = getCharIndexForText(content, location.text);

    if (position === 'after') {
      // Move past the search text
      insertIndex += location.text.length;
    }
  } else {
    throw new Error('Location must specify line or text');
  }

  // Build the insertion string based on format
  let insertion: string;

  if (format === 'newline') {
    if (position === 'before') {
      // Insert reference on its own line before
      insertion = `${refString}\n`;
    } else {
      // Insert reference on its own line after
      insertion = `\n${refString}`;
    }
  } else {
    // inline format
    if (position === 'before') {
      // Insert reference with a space after it
      insertion = `${refString} `;
    } else {
      // Insert reference with a space before it
      insertion = ` ${refString}`;
    }
  }

  // Insert the reference
  const updatedContent =
    content.slice(0, insertIndex) +
    insertion +
    content.slice(insertIndex);

  return updatedContent;
}
