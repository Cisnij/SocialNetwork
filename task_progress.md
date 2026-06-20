# Task Progress Checklist - DONE

## Phase 1: Backend Logic Fixes & API Verification
- [x] Fix DeleteOptionVoteGroupChat - wrong check (must be option creator, not vote creator)
- [x] Fix conversation list to show pending conv without messages when user clicks
- [x] Fix ListVoteGroupChat ordering - DONE in existing code

## Phase 2: Chat UI/UX Fixes
- [x] Fix "seen" to show avatar images instead of text "Đã xem"
- [x] Fix conv context menu (3 dots) - items hidden/cut off
- [x] Fix file display in chat - images render inline, others show download
- [ ] Make left conv sidebar resizable/draggable on desktop (optional enhancement)
- [x] Fix accept/reject message flow - properly detect first message sender

## Phase 3: Group Chat Features
- [x] Show "đã xem" details - who has seen the message
- [x] View members modal in group chat
- [x] Fix leave group - leave button in conv name area
- [x] Add kick member feature to modal
- [x] Show "bạn không còn trong nhóm" when left group

## Phase 4: Task & Todo Features
- [x] Create Task modal with member selection flow
- [x] Add Member into Task after creating
- [x] MemberOfTaskGroupChat integration
- [x] Update/Delete Task (only creator)
- [x] List tasks with appropriate ordering

## Phase 5: Vote Features
- [x] Create vote modal with options
- [x] Delete vote (only creator)
- [x] Update vote (only creator)
- [x] Add/Update/Delete options
- [x] List votes with % calculation
- [x] List users who voted on option
- [x] User voting toggle

## Phase 6: Report & Comment Fixes
- [x] Fix comment modal not showing
- [x] Add comment report functionality to FE

## Phase 7: General UI/UX & Mobile Optimization
- [ ] Fix navbar positions (bottom nav on mobile) - pending
- [ ] Optimize chat for mobile - pending
- [x] GetFileFromConversation button in chat header via info modal