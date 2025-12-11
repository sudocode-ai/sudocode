# Test 8: npm install without prompts - Results

## Test Configuration

**Test Date:** 2025-12-11
**Test Type:** Positive test (should succeed)
**Goal:** Verify npm can fetch packages without prompts

## Setup

1. Created test directory: `test-npm-sandbox/`
2. Created `package.json` with single dependency (lodash ^4.17.21)
3. Applied sandbox configuration from s-2bvw:
   - Sandbox enabled
   - `autoAllowBashIfSandboxed: true`
   - WebFetch allowed (no pattern specified)
   - Read permissions limited to CWD
   - Excluded commands: docker

## Test Execution

### Command
```bash
claude --settings .claude-settings.json "Run npm install"
```

### Expected Result
- npm install succeeds
- Packages downloaded from npmjs.com
- No user prompts

### Actual Result
**❌ FAILED - User prompt appeared**

Claude Code displayed the following prompt:
```
The npm install command needs your approval to run without sandbox restrictions
due to the environment variable issue.

The command is being blocked because there's an `npm_config_prefix` environment
variable set to "/opt/homebrew" that conflicts with nvm. Running with
`dangerouslyDisableSandbox: true` will allow the command to execute.

Would you like me to proceed with the npm install?
```

## Analysis

### Root Cause
The test environment has an `npm_config_prefix` environment variable conflict:
```
nvm is not compatible with the "npm_config_prefix" environment variable:
currently set to "/opt/homebrew"
```

This environment variable issue causes Claude Code to request permission to disable the sandbox for the npm command, which triggers a user prompt.

### Observations

1. **npm works directly**: Running `npm install` directly (without Claude Code) succeeds without issues and installs packages successfully.

2. **Sandbox detects environment conflict**: Claude Code's sandbox appears to detect the npm_config_prefix/nvm conflict and treats this as a security concern requiring explicit approval.

3. **WebFetch permission insufficient**: Having `WebFetch` in the allow list is not sufficient to bypass the sandbox requirement when environment variable conflicts are detected.

4. **autoAllowBashIfSandboxed not applied**: Despite `autoAllowBashIfSandboxed: true`, Claude Code still requests approval. This suggests the flag may not cover all Bash command scenarios, particularly those involving environment variable conflicts.

## Failure Modes Encountered

- ✅ Install blocked: NO (would work with approval)
- ❌ **Prompt for npm registry domain**: YES (prompt appeared, but for sandbox bypass not domain)
- ✅ Network timeout: NO

## Potential Workarounds

### Option 1: Exclude npm from sandbox
Add npm to excludedCommands:
```json
{
  "sandbox": {
    "excludedCommands": ["docker", "npm"]
  }
}
```

### Option 2: Fix environment variable
Unset the conflicting variable:
```bash
unset npm_config_prefix
```

### Option 3: Use yarn or pnpm
Test if alternative package managers avoid the conflict.

### Option 4: Add npm-specific network permission
Investigate if there's a more granular permission for npm specifically.

## Recommendations

1. **Update Test Spec**: Document that npm install may require special handling due to environment variable conflicts
2. **Test Alternative Configuration**: Try adding npm to excludedCommands
3. **Document Known Issue**: Note that nvm/npm_config_prefix conflicts may require manual intervention
4. **Consider Environment-Specific Config**: Provide guidance for users with similar environment setups

## Additional Testing

### Test 2: npm in excludedCommands
**Configuration:**
```json
{
  "sandbox": {
    "excludedCommands": ["docker", "npm"]
  }
}
```

**Result:** ❌ FAILED - Still prompted for approval

Claude Code still requested permission with message:
```
The command requires approval to run without sandbox restrictions. The issue is
that the sandbox environment has the `npm_config_prefix` environment variable
set to "/opt/homebrew", which conflicts with nvm.
```

**Analysis:** Adding npm to excludedCommands is not sufficient when environment variable conflicts exist.

### Test 3: Environment Variable Unset
**Command:**
```bash
unset npm_config_prefix && claude --settings .claude-settings.json "Run npm install"
```

**Result:** ❌ FAILED - Still prompted

Claude Code now reported:
```
The sandbox is blocking file system operations. The command requires your
approval to proceed with npm install outside the sandbox restrictions.
```

**Analysis:** Even with the environment variable unset in the command, shell initialization resets it. Additionally, the sandbox may be blocking write operations to node_modules/.

## Root Cause Analysis

The test reveals multiple layers of sandbox restrictions:

1. **Environment Variable Conflict**: nvm/npm_config_prefix conflict triggers security warning
2. **File System Write Restrictions**: Sandbox may block writes to node_modules/
3. **excludedCommands Limitation**: excludedCommands doesn't bypass environment-based security checks
4. **autoAllowBashIfSandboxed Scope**: Doesn't cover all Bash scenarios, particularly those with environment conflicts

## Implications for s-2bvw

This test reveals that the proposed sandbox configuration in [[s-2bvw]] has significant limitations:

1. **npm workflows blocked**: Standard npm install cannot run without prompts in the proposed sandbox
2. **Environment sensitivity**: Sandbox behavior is highly dependent on user environment setup
3. **excludedCommands insufficient**: Simply excluding commands is not enough for automation
4. **Write permissions unclear**: The interaction between read/write permissions and package installation is not well-defined

## Next Steps

- [x] Test with npm in excludedCommands
- [x] Test with environment variable unset
- [ ] Test with alternative package managers (yarn, pnpm)
- [ ] Investigate write permissions configuration
- [ ] Test with sandbox fully disabled
- [x] Update s-2bvw spec with npm-specific guidance
- [x] Document this as a known limitation in the sandbox configuration

## Test Status

**FAILED** - User prompt appeared in all test scenarios, blocking automated workflow

**Severity:** CRITICAL - This is a high-priority failure that blocks common development workflows:
- npm/yarn/pnpm package installation
- Automated dependency management
- CI/CD-like workflows in sandboxed environments

## Recommendations

1. **Update s-2bvw spec**: Add explicit note that npm workflows require additional configuration or may not be fully automatable in sandbox mode
2. **Document workaround**: Provide clear guidance on when sandbox must be disabled
3. **Test alternative**: Consider testing if Docker-based isolation provides better automation support
4. **Feature request**: Consider filing feature request with Claude Code for better npm/package manager support in sandbox mode
5. **Environment setup**: Document required environment configuration for sandbox to work with npm
