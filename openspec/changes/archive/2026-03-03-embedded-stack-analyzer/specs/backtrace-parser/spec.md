## ADDED Requirements

### Requirement: Extract hex addresses from backtrace
The parser SHALL extract all hexadecimal addresses from the backtrace log text, supporting common embedded backtrace formats.

#### Scenario: GDB backtrace format
- **WHEN** input contains lines like `#0 0x08001234 in main () at main.c:10`
- **THEN** the parser extracts `0x08001234`

#### Scenario: ESP-IDF panic format
- **WHEN** input contains lines like `0x400d1234:0x3ffb5e10 0x400d5678:0x3ffb5e30`
- **THEN** the parser extracts the PC addresses `0x400d1234` and `0x400d5678`

#### Scenario: ARM HardFault register dump
- **WHEN** input contains `PC: 0x08004567` or `LR: 0x08004560`
- **THEN** the parser extracts the addresses from PC and LR registers

#### Scenario: Generic hex address
- **WHEN** input contains standalone hex addresses like `0xDEADBEEF`
- **THEN** the parser extracts them as addresses

#### Scenario: No addresses found
- **WHEN** input contains no recognizable hex addresses
- **THEN** the parser returns an empty address list

### Requirement: Preserve backtrace context
The parser SHALL associate each extracted address with its original line text for display context.

#### Scenario: Address with context
- **WHEN** an address `0x08001234` is extracted from line `#0 0x08001234 in ?? ()`
- **THEN** the result includes both the address and the original line text

### Requirement: Deduplicate addresses
The parser SHALL deduplicate extracted addresses before passing to addr2line.

#### Scenario: Duplicate addresses
- **WHEN** the same address `0x08001234` appears multiple times in the backtrace
- **THEN** the address is passed to addr2line only once, but all occurrences in the output are resolved
