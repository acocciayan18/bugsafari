# TODO: Connect Optimization Matrix to Backend ✅ COMPLETE

## Task: Wire up optimization toggles to actually affect test execution

### Implementation Complete ✓

All files have been updated to pass optimization settings from UI to backend:

- [x] `types.ts` - OptimizationSettings interface defined
- [x] `EngineGateway.ts` - startTest() accepts optimizationSettings parameter  
- [x] `SocketHttpEngineGateway.ts` - Passes optimization in API request body
- [x] `useDashboardController.ts` - Accepts and passes optimizationSettings
- [x] `App.tsx` - Manages optimization state, passes to CommandCenter
- [x] `CommandCenter.tsx` - UI toggles with onOptimizationChange callback

### Data Flow

1. User toggles optimization in CommandCenter UI
2. toggleOptimization() calls onOptimizationChange() callback
3. App.tsx updates optimizationSettings state
4. handleStartWithOptimization() calls startTest(url, optimizationSettings)
5. useDashboardController passes to gateway.startTest()
6. SocketHttpEngineGateway includes in POST request body

### API Request Format

```json
POST /api/start-test
{
  "url": "https://target.example.com",
  "optimization": {
    "adaptive-risk-scorer": true,
    "state-aware-hashing": true,
    "concurrent-spam-event": true
  }
}
```
