# Tasks

## Implementation Order

1. **Validate proposal structure**
   - Run `openspec validate add-test-spec --strict`
   - Verify all required files are present

2. **Apply the change**
   - Run `openspec apply add-test-spec`
   - Verify spec is created in `openspec/specs/test-spec/`

3. **Verify spec contents**
   - Check spec.md has correct format
   - Confirm requirements and scenarios are preserved

4. **Archive the change**
   - Run `openspec archive add-test-spec`
   - Verify change is moved to archived state
