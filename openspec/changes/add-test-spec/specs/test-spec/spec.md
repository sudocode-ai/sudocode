# Test Spec

A test specification to validate the OpenSpec workflow.

## ADDED Requirements

### Requirement: Basic greeting functionality
The system SHALL provide a greeting message to users.

#### Scenario: Default greeting
- **Given** a user requests a greeting
- **When** no name is provided
- **Then** the system returns "Hello, World!"

#### Scenario: Personalized greeting
- **Given** a user requests a greeting
- **When** a name "Alice" is provided
- **Then** the system returns "Hello, Alice!"

### Requirement: Greeting format validation
The greeting message MUST follow a consistent format.

#### Scenario: Greeting format structure
- **Given** any greeting request
- **When** the greeting is generated
- **Then** it starts with "Hello, " and ends with "!"
