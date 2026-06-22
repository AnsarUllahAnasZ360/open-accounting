# Ask AI AI Elements Chatbot Pass

## Goal

Re-shape the OpenBooks Ask AI surface to follow the AI Elements chatbot example:
conversation content first, suggestions directly above the composer, and a large
chat input as the main action.

## Keep OpenBooks-Specific

- Convex Agent thread persistence.
- Conversation picker for existing chats.
- New, rename, and delete conversation actions.
- Proposal confirmation cards that preserve "AI proposes, ledger engine posts."

## Remove Or Minimize

- Bulky Ask AI header/subtitle chrome.
- Separate fullscreen-style controls.
- Repeated suggestion chips after the user is already in a conversation.
- Tiny composer layout that feels like a disabled footer instead of a chat box.

## Done When

- Docked Ask AI visually reads like the AI Elements chatbot panel.
- Composer is large, enabled after context loads, and easy to type in.
- Thread controls remain reachable but secondary.
- Typecheck, lint, Ask AI e2e, and Browser verification pass.
