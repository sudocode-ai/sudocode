# API Design Specification

## Purpose

This specification defines the REST API design standards for the project.

### Requirement: Endpoint Naming

All API endpoints SHALL follow RESTful naming conventions.

#### Scenario: Resource collection endpoint

- **WHEN** accessing a collection of resources
- **THEN** use plural noun form (e.g., `/users`, `/posts`)

#### Scenario: Individual resource endpoint

- **GIVEN** a resource with ID "123"
- **WHEN** accessing the individual resource
- **THEN** use format `/resources/{id}` (e.g., `/users/123`)

### Requirement: Response Format

API responses SHALL use consistent JSON formatting.
