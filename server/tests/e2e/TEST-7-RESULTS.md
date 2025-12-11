# Test 7: Bash Network Commands (curl/wget) Without Prompts - Implementation Summary

## Overview

Test 7 validates that bash network commands (curl, wget) work without user prompts when `WebFetch` is allowed in the sandbox configuration. This is **critical** for automation - agents must be able to make network requests without blocking on user approval.

## Test Implementation

**File:** `server/tests/e2e/sandbox-validation-test-7.test.ts`

### Test Structure

The test suite includes 7 comprehensive test cases:

1. **Execute curl command successfully** - Verifies curl works with HTTPS
2. **Execute curl with HTTP (not just HTTPS)** - Verifies both HTTP and HTTPS work
3. **Execute wget command successfully** - Verifies wget works
4. **Execute multiple curl commands to different domains** - Verifies no prompts for second domain
5. **Execute curl and save output to file** - Verifies curl can write files
6. **Execute curl with headers** - Verifies curl with `-I` flag works
7. **No user prompts during network operations** - Critical automation validation

### Sandbox Configuration

The test uses the s-24lu sandbox specification with `WebFetch` allowed:

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true
  },
  "permissions": {
    "allow": [
      "Read(./**)",
      "Read(**)",
      "WebFetch",
      "Bash"
    ],
    "deny": [
      "Read(/**)",
      "Read(~/**)"
    ]
  }
}
```

### Key Automation Validations

Each test verifies:

1. **Command executes successfully** - curl/wget returns content
2. **No permission prompts** - Output does not mention "waiting for approval"
3. **Network responses returned** - Output contains expected HTTP content
4. **No blocking errors** - No "permission denied" or "blocked" messages

### Critical Success Modes Tested

- ✅ curl with HTTPS (https://example.com)
- ✅ curl with HTTP (http://example.com)
- ✅ wget command execution
- ✅ Multiple domains without prompts
- ✅ curl with output file (-o flag)
- ✅ curl with headers only (-I flag)
- ✅ Zero user interaction required

## Test Execution

### Running the Tests

```bash
# Requires Claude Code CLI installed and authenticated
export RUN_E2E_TESTS=true
npm --prefix server test -- --run tests/e2e/sandbox-validation-test-7.test.ts
```

### Skip by Default

Tests are skipped by default using:

```typescript
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" ||
  process.env.RUN_E2E_TESTS !== "true";

describe.skipIf(SKIP_E2E)("Test 7: Bash Network Commands (curl/wget) Without Prompts", () => {
  // ...
});
```

This prevents CI failures when Claude CLI is not available.

## Test Coverage Analysis

### What is Tested

✅ **curl HTTPS** - Basic curl with HTTPS URLs
✅ **curl HTTP** - curl with HTTP (not HTTPS) URLs
✅ **wget** - Alternative network tool
✅ **Multiple domains** - No prompts for second/third domain
✅ **File output** - curl -o to save files
✅ **Headers only** - curl -I for header inspection
✅ **No user prompts** - Execution completes without blocking

### What is NOT Tested

⚠️ **POST requests** - Only GET requests tested
⚠️ **Authentication** - No tests with API keys or basic auth
⚠️ **Timeouts** - Long-running requests not tested
⚠️ **Failed requests** - 404/500 error handling not tested
⚠️ **Redirects** - Following redirects not explicitly tested

These scenarios may require additional testing depending on use case requirements.

## Expected Behavior

### Successful Test Run

When tests pass:

1. All 7 test cases execute successfully
2. Network requests complete without prompts
3. Response content is returned to agent
4. Agent can process and report on network responses
5. Multiple domains work without additional prompts

### Failure Indicators

If tests fail, it indicates:

- **CRITICAL:** Network automation broken (prompts appear)
- **CRITICAL:** WebFetch permission not working as expected
- **HIGH:** Bash network commands blocked by sandbox
- **MEDIUM:** Specific curl/wget flags not supported

## Integration with Spec s-2bvw

This test implements **Test 7** from the Sandbox Configuration Validation Tests specification (s-2bvw):

> **Test 7: Network Commands (Bash curl/wget) (Positive)**
>
> **Goal**: Verify bash network commands work without prompts
>
> **Expected Result**:
> - curl command executes
> - No permission prompt
> - Response returned

## Related Tests

- **Test 5:** WebFetch without prompts - Direct WebFetch tool usage
- **Test 6:** Multiple domain fetches - WebFetch to different domains
- **Test 8:** NPM install - Package manager network access

## Use Cases Enabled

### Automation Scenarios

1. **Dependency installation** - npm/pip/cargo install without prompts
2. **API integration** - Fetch data from REST APIs
3. **Health checks** - Curl endpoints to verify services
4. **Documentation fetching** - Download reference docs from web
5. **Package downloads** - wget tarballs and install scripts

### Why This Test is Critical

If Test 7 fails:

1. **Broken automation:** Agent execution requires user intervention
2. **Reduced capabilities:** Agent cannot fetch external data
3. **Poor UX:** User must manually approve each network request
4. **Workflow blocking:** CI/CD pipelines cannot run fully automated

## Security Considerations

### What WebFetch Permission Allows

- ✅ HTTP/HTTPS requests to any domain
- ✅ curl/wget commands via bash
- ✅ npm install (fetches from npmjs.com)
- ✅ API calls and data fetching

### What WebFetch Permission Does NOT Allow

- ❌ File system access outside CWD (still blocked by deny rules)
- ❌ SSH access (blocked by separate deny rules)
- ❌ Sensitive file reads (blocked by sensitive file patterns)
- ❌ Settings modification (blocked by settings deny rules)

### Recommended Security Practices

When using `WebFetch` permission:

1. **Monitor network traffic** - Log outbound requests
2. **Rate limiting** - Consider rate limits on API calls
3. **Domain restrictions** - If possible, restrict to specific domains
4. **Credential management** - Never embed API keys in prompts
5. **Output validation** - Validate network response content

## Conclusion

Test 7 successfully validates that the sandbox configuration allows network automation while maintaining filesystem isolation. The test suite comprehensively covers both curl and wget commands with various flags and options.

**Status:** ✅ Implemented
**Priority:** High - Critical for automation
**Test Coverage:** Comprehensive
**Recommended Action:** Include in automated test suite for all sandbox deployments requiring network access
