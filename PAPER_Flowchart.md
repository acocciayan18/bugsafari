# System Flowchart

## What this shows

The first flowchart follows one complete test run from the moment the tester submits a
URL to the moment the report is either saved or dropped. The decision points in the
middle are the important part, because they are what separates BugSafari from a recorded
test script: the system decides at every step which element to touch, whether it has
already seen the page it landed on, and whether something went wrong.

The second flowchart isolates the learning loop, which is easier to follow on its own.

## Main run flowchart

```mermaid
flowchart TD
    START(["Start"]) --> INPUT["Tester submits target URL and picks attack types"]
    INPUT --> VALID{"URL valid and reachable?"}
    VALID -->|"No"| REJECT["Show error message"] --> STOPEND(["End"])
    VALID -->|"Yes"| CREATE["Create run record and open Chromium browser"]
    CREATE --> WARM["Load learned weights for this site if any exist"]
    WARM --> VISIT["Open the target page"]

    VISIT --> PARSE["Read the page and list the interactive elements"]
    PARSE --> ANY{"Any usable elements?"}
    ANY -->|"No"| BACK["Go back to the previous page"] --> LIMIT
    ANY -->|"Yes"| SCORE["Score every element with the rules plus the learned model"]
    SCORE --> PICK["Pick the highest scoring element not yet tried here"]
    PICK --> ACT["Perform the action or run an attack scenario on it"]

    ACT --> OBSERVE["Record what happened: new page, console errors, failed requests"]
    OBSERVE --> HASH["Hash the new page structure"]
    HASH --> SEEN{"Page already seen?"}
    SEEN -->|"Yes"| PENAL["Lower that element's score and mark the path as stale"] --> BUG
    SEEN -->|"No"| NEWSTATE["Record the new page as visited"] --> BUG

    BUG{"Did the bug finders confirm a problem?"}
    BUG -->|"Yes"| RECORD["Save the finding with its severity and the steps that caused it"] --> STREAM
    BUG -->|"No"| STREAM["Send the step, screenshot and any errors to the dashboard"]

    STREAM --> LEARN["Update the model weights from the result of this action"]
    LEARN --> LIMIT{"Step limit reached, timeout, or stop pressed?"}
    LIMIT -->|"No"| NEXT{"Still something new to try on this page?"}
    NEXT -->|"Yes"| PARSE
    NEXT -->|"No"| NAV["Move to a different page or backtrack"] --> PARSE

    LIMIT -->|"Yes"| CLOSE["Close the browser and build the summary"]
    CLOSE --> AUTH{"Is the user signed in?"}
    AUTH -->|"Yes"| SAVE["Save the run, findings and logs to the database"] --> REPORT["Report available in history"] --> STOPEND
    AUTH -->|"No"| DROP["Discard the run, keep it on screen only"] --> STOPEND
```

## Learning loop flowchart

```mermaid
flowchart LR
    F["Turn the element into features: tag, input type, keywords in the label, size, position on the page"]
    F --> S["Model produces a score between 0 and 1"]
    S --> M["Mix it with the rule based score, 60 percent rules and 40 percent model"]
    M --> A["Act on the best element"]
    A --> O{"Was the action useful?"}
    O -->|"New page or a finding"| R["Reward: push the weights towards this kind of element"]
    O -->|"Nothing changed or a repeat"| P["Penalty: push the weights away from it"]
    R --> D["Apply the delta rule and adjust the weights"]
    P --> D
    D --> SNAP["Every ten steps, save the weights for this user and site"]
    SNAP --> F
```

## Decision points explained

| Decision | Why it exists |
| --- | --- |
| URL valid and reachable | Blocks bad addresses and internal or private addresses before a browser is opened |
| Any usable elements | A page with nothing to click is a dead end, so the engine backs out instead of stalling |
| Page already seen | The structural hash catches loops. Without it the engine would keep clicking between the same two screens |
| Did the bug finders confirm a problem | Raw console noise is not a bug. A finding is only recorded when a finder can name the cause |
| Step limit, timeout, or stop | Three separate ways for a run to end, so it always terminates |
| Is the user signed in | Guests reach the same summary but nothing is written to the database |

## Notes on the learning step

The score used to pick an element is not purely learned. Sixty percent comes from fixed
rules about tags, input types and keywords in labels, and forty percent from the model.
This keeps early behaviour sensible before the model has seen anything, and lets the
model improve the ranking over time.

The weights are saved against both the user and the site address. A run against the same
site later starts with the weights from last time instead of starting over, and one
user's learned weights are never used for another user's run.
