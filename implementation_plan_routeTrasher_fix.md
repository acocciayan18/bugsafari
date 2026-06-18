# Implementation Plan

## Overview

Update the `RouteTrashMetadata` interface in `ChaosTransactionManager.ts` to make `targetPath` optional, synchronizing it with how it's actually used in the `routeTrasher.ts` scenario. This fixes a type mismatch where `targetPath` is currently required but initialized as an empty string in practice.

## Types

Update the `RouteTrashMetadata` interface to make `targetPath` optional:

```typescript
export interface RouteTrashMetadata {
  originPath: string;
  targetPath?: string; // Changed from required to optional
  injectedPath?: string;
  navigationType?: 'history_back' | 'history_forward' | 'query_mutation' | 'malformed_push';
}
```

## Files

- **Modified**: `testing-core/src/domain/fuzzing/ChaosTransactionManager.ts`
  - Change `targetPath: string` to `targetPath?: string` in `RouteTrashMetadata` interface

## Functions

No function changes required - this is purely a type definition update.

## Classes

No class changes required.

## Dependencies

No dependency modifications.

## Testing

- Verify TypeScript compiles without errors
- Verify the routeTrasher scenario can still use the metadata with or without targetPath

## Implementation Order

- [x] 1. Update `RouteTrashMetadata` interface in `ChaosTransactionManager.ts` - change `targetPath: string` to `targetPath?: string`
- [x] 2. Verify TypeScript compilation succeeds
