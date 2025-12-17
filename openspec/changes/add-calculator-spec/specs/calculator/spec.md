# Calculator

A basic calculator specification for arithmetic operations.

## ADDED Requirements

### Requirement: Addition operation

The calculator SHALL support adding two numbers.

#### Scenario: Add positive numbers

- **Given** the calculator is ready
- **When** the user adds 2 and 3
- **Then** the result is 5

#### Scenario: Add negative numbers

- **Given** the calculator is ready
- **When** the user adds -5 and -3
- **Then** the result is -8

### Requirement: Division operation

The calculator SHALL support dividing two numbers.

#### Scenario: Divide whole numbers

- **Given** the calculator is ready
- **When** the user divides 10 by 2
- **Then** the result is 5

#### Scenario: Division by zero

- **Given** the calculator is ready
- **When** the user divides 10 by 0
- **Then** the calculator MUST return an error

### Requirement: Input validation

The calculator MUST validate that inputs are numeric.

#### Scenario: Invalid input handling

- **Given** the calculator is ready
- **When** the user provides non-numeric input "abc"
- **Then** the calculator returns a validation error
