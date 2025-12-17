# CLI Init Specification

## Purpose

The `openspec init` command SHALL create a complete OpenSpec directory structure in the current project directory. This enables projects to adopt the OpenSpec format for specification management.

### Requirement: Directory Creation

The command SHALL create the complete OpenSpec directory structure with all necessary subdirectories and configuration files.

#### Scenario: Creating OpenSpec structure in empty directory

- **GIVEN** the current directory has no `.openspec` folder
- **WHEN** `openspec init` is executed
- **THEN** create the directory structure:
  - `.openspec/`
  - `.openspec/specs/`
  - `.openspec/changes/`
  - `.openspec/config.json`

#### Scenario: Running init in existing OpenSpec directory

- **GIVEN** the current directory already has an `.openspec` folder
- **WHEN** `openspec init` is executed
- **THEN** display warning message about existing installation
- **THEN** prompt user for confirmation before proceeding

### Requirement: Configuration File

The command SHALL create a valid configuration file with sensible defaults.

#### Scenario: Default configuration creation

- **WHEN** `openspec init` creates the config file
- **THEN** the config file SHALL contain version information
- **THEN** the config file SHALL use JSON format

### Requirement: Error Handling

The command SHALL handle errors gracefully and provide helpful error messages.

#### Scenario: Permission denied error

- **GIVEN** the user does not have write permission to the current directory
- **WHEN** `openspec init` is executed
- **THEN** display a clear error message indicating permission issue
- **THEN** exit with non-zero status code
