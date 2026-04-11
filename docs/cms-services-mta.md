# CMS Web Services Reference — Mapped to Top 10 Support Issues

> Living document. Maps the MatchTennisApp CMS web services to the most common support questions.
> CMS API class: `AdminMtaMain` (200+ methods)
> CMS repo: `/Users/heathwatersnew/Projects/matchtennisapp/`
> Last updated: 2026-03-21

---

## Top 10 Support Issues vs Available CMS Services

### #1. Feature How-To / Walkthroughs (14% of chats | 9.5 min avg)

**What customers ask:** "How do I do X in the app?"
**Resolution:** KB answer + video link + step-by-step guide
**Agent action needed:** Send the right guide

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| N/A — resolved from KB | Knowledge base has 1,072 entries | Read | AI/agent sends matching KB answer |
| `getAiHistoryList()` | Previous AI suggestions for similar questions | Read | See what AI told other customers |

**Already built in support app:**
- `searchKB` tool (semantic + keyword hybrid search)
- `traverseTree` tool (11 decision trees, 514 nodes)
- Canned responses system

**What to build:** Smart suggested responses based on detected issue category. Pre-load top 3 KB matches into context panel.

---

### #2. Pre-Tournament Check-in / Waiver Completion (MTA-specific)

**What customers ask:** "I completed the form but tournament isn't showing" / "How do I check in for my tournament?"
**Resolution:** Verify waiver/check-in form was completed correctly, check for data errors

The pre-tournament check-in flow:
1. Parent/player clicks waiver link on USTA webpage OR the check-in button in MTA app
2. Completing the form programmatically adds the tournament to their MTA calendar home page
3. Associates the player to the event, enabling check-in and score reporting features
4. If completed with errors (e.g., mistyped USTA#), the player won't sync correctly

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getCompletedWaiversByUser(reguser_id)` | All signed waivers for user | Read | Check if waiver is signed |
| `getWaiverByTournIDPlayerIDorUSTAno()` | Waiver for specific tournament | Read | Check specific tournament waiver |
| `getWaiverDetail(waiver_id)` | Full waiver details | Read | Inspect for data errors (mistyped USTA#, etc.) |
| `getWaiverListByTourn(tourn_id)` | All waivers for tournament | Read | See all check-ins for this tournament |
| `getCompetitorRecordsByTournUSTAID()` | Competitor status in tournament | Read | Is player registered as competitor? |
| `getUserProductOrderList(usr_id)` | Purchase/order history | Read | Did they pay? |
| `getTransactionList(array)` | Payment transaction history | Read | Payment succeeded or failed? |

**Already built in support app:**
- Customer lookup (name, email, USTA#, linked players/teams)
- Decision tree covers waiver troubleshooting

**What to build:** Auto-check waiver completion status. Show checklist: Waiver [x], Payment [x], USTA# valid [x].

---

### #2b. Serve Sync / VTD Issues (MTA-specific — Tournament Directors)

**Who contacts support:** Tournament directors (not parents/players)
**What they ask:** "Player is red on registrations" / "Player is grey on VTD" / "Draw changes not showing"
**Resolution:** Check waiver status, fix data errors, re-sync matches/draws

**The two views tournament directors use:**

```
PLAYER REGISTRATIONS LIST        VIRTUAL TOURNAMENT DESK (VTD)
┌─────────────────────────┐     ┌─────────────────────────┐
│ Jake Johnson   WHITE ✅  │     │ Court 1 - 10:00 AM     │
│ (waiver complete)       │     │ Jake Johnson (normal)   │
│                         │     │ vs                      │
│ Emma Johnson   RED ⚠️   │     │ Emma Johnson  GREY ⚠️   │
│ (waiver NOT complete    │     │ (waiver not complete    │
│  or data error)         │     │  or data error)         │
└─────────────────────────┘     └─────────────────────────┘

WHITE on Registrations = waiver complete, player synced ✅
RED on Registrations = waiver incomplete or error ⚠️
GREY on VTD = same issue, different view — player not synced ⚠️
```

**Common scenarios:**
1. **Player red/grey:** Waiver not completed, or completed with wrong USTA# — check waiver detail for errors
2. **Draw changes not reflecting:** Director changed draw but VTD shows old data — needs "matches re-sync"
3. **Stale pending data:** Old pending matches cluttering VTD — needs "purge pending"

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getWaiverByTournIDPlayerIDorUSTAno()` | Check waiver by tournament + player | Read | Is this player's waiver complete? |
| `getWaiverDetail(waiver_id)` | Full waiver with all entered data | Read | Find data errors (wrong USTA#, typos) |
| `getCompetitorRecordsByTournUSTAID()` | Competitor status | Read | Is player registered in the system? |
| `getPlayerRecordsByPlayerUstaID(ustaID)` | Lookup player by USTA# | Read | Verify USTA# is correct |
| `validateMatchesByTournament()` | Validate all match data | Read | Check for data inconsistencies |
| `resetIndMatchUpsMatch()` | Reset matchups (matches re-sync) | **Write** | **Force VTD to rescan draws** |
| `purgePendingMatches()` | Purge pending matches | **Write** | **Clear stale pending data from VTD** |
| `fixMatchesParticipants()` | Repair participant data | **Write** | Fix player associations after draw change |
| `fixMatchesTimeSiteDate()` | Fix match timing/site issues | **Write** | Repair schedule data |

**Already built in support app:**
- Customer/player lookup with USTA#
- Decision tree covers VTD troubleshooting

**What to build:**
- One-click "Matches Re-Sync" button (calls `resetIndMatchUpsMatch()`)
- One-click "Purge Pending" button (calls `purgePendingMatches()`)
- Waiver detail viewer showing entered data vs expected data (highlight mismatches)
- Player registration status indicator (white/red) pulled from waiver data

---

### #3. Lineup / Match Card Editing (12% | 25.4 min avg)

**What customers ask:** "I need to change my lineup" / "Match card has wrong players"
**Resolution:** View match details, edit lineup, fix participants
**Agent action needed:** Complex — often requires CMS admin intervention

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getTeamTournMatchCard(team_id)` | Team's match card | Read | View current lineup |
| `getTeamTournMatchUpList(team_id)` | Upcoming matches | Read | See scheduled matches |
| `getIndMatchParticipantsList()` | Players in a match | Read | Who's in this match? |
| `getMatch()` | Single match record | Read | Match details |
| `updateMatch()` | Modify match details | **Write** | Fix match data |
| `updateIndMatchScore()` | Update score | **Write** | Correct scores |
| `deleteMatchPlayer()` | Remove player from match | **Write** | Fix lineup |
| `switchMatchPlayerOrder()` | Swap player positions | **Write** | Reorder lineup |
| `updateTournIndPartPlayerID()` | Change participant player | **Write** | Swap player in match |
| `fixMatchesParticipants()` | Repair participant data | **Write** | Bulk fix |
| `restoreMatchcardFromLog()` | Restore from history | **Write** | Undo changes |
| `validateMatchesByTournament()` | Validate match data | Read | Check for errors |

**Already built in support app:**
- Decision tree: "Lineup/Match Card" (126 chats, 57 nodes)

**What to build:** Match card viewer in context panel (read-only initially). Link to CMS for edits. Future: inline lineup editing.

---

### #4. Password Reset / Account Lockout (10% | 6.9 min avg)

**What customers ask:** "I can't log in" / "Reset my password" / "Account locked"
**Resolution:** Verify identity, unlock account, send reset link
**Agent action needed:** Check lock status, unlock, send reset

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getLoginAttemptForUser()` | Failed login attempt count | Read | Is account locked? How many attempts? |
| `removeLoginAttemptForUser()` | Clear failed login counter | **Write** | **Unlock account** |
| `generateResetPasswordLink()` | Create secure reset URL | **Write** | **Send reset link** |
| `updatePass()` | Directly change password | **Write** | Emergency password set |
| `checkHashedPass()` | Verify current password | Read | Confirm identity |
| `restoreUserAuth()` | Restore deleted auth record | **Write** | Recover deleted account auth |

**Already built in support app:**
- `verifyIdentity` tool (2-factor: usta_email, 3-factor: name_email_username)
- `generateResetLink` tool (AES-128-CBC encrypted, 36h expiry, MTA only)
- Hard cap: 3 verification attempts per conversation

**What to build:**
- Show failed login count + lock status automatically
- One-click "Unlock Account" button (calls `removeLoginAttemptForUser()`)
- One-click "Send Reset Link" for agents (bypass AI verification flow)

---

### #5. Account Info Updates / Profile Corrections (9% | 5.4 min avg)

**What customers ask:** "Update my email" / "Wrong name on my account" / "Change my phone"
**Resolution:** Look up account, make correction
**Agent action needed:** View profile, update field

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getUserDetail(usr_id)` | Full user profile | Read | View all account fields |
| `getPlayerRecord(player_id)` | Player profile | Read | View player data |
| `updateFormSingleData()` | Update any single field | **Write** | Change email, name, phone, etc. |
| `updateRecord()` | Generic record update | **Write** | Update any table record |
| `relatedUserData()` | Find connected accounts | Read | See if duplicate exists |
| `mergeIntoOtherUser()` | Merge duplicate accounts | **Write** | Combine two accounts |
| `searchDuplicateUSTAUsers()` | Find USTA duplicates | Read | Proactive duplicate detection |
| `updateUserLocalTimezone()` | Fix timezone | **Write** | Common fix request |

**Already built in support app:**
- `lookupCustomer` tool (MySQL queries for MTA + MTT)
- Context panel shows customer data

**What to build:**
- Editable fields in context panel (click to edit name, email, phone)
- Duplicate detection alert (auto-run `searchDuplicateUSTAUsers()`)
- One-click "Merge Accounts" with confirmation

---

### #6. Add/Link Player to Account (9% | 8.3 min avg)

**What customers ask:** "Add my daughter" / "Link a player" / "Player not showing"
**Resolution:** Search for player, link to account
**Agent action needed:** Search + link

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getPlayerRecordsByPlayerUstaID(ustaID)` | Lookup by USTA# | Read | Find player by USTA number |
| `searchPlayerUSTAname()` | Search by USTA name | Read | Find by name |
| `getPlayerRecordsByNameCity(params)` | Search by name + city | Read | Broader search |
| `getRelatedPlayers(array)` | Find related players | Read | Connected players |
| `addPlayerRelationToUser()` | **Link player to account** | **Write** | The actual resolution |
| `removePlayerRelationFromUser()` | Unlink player | **Write** | Fix wrong links |
| `insertPlayer()` | Create new player record | **Write** | If player doesn't exist |
| `getPlayerWatchByUser(reguser_id)` | Player watch list | Read | What players does user follow? |
| `searchPlayerByServeTennisID()` | Lookup by Serve ID | Read | Alternative search |

**Already built in support app:**
- `lookupCustomer` shows linked players
- Decision tree: "Add/Link Player" (92 chats, 38 nodes)

**What to build:**
- Player search widget in context panel (USTA#, name, city)
- Search results with "Link to Account" button
- One-click link action

---

### #7. Data Caching / Tournament List Refresh (8% | 6.6 min avg)

**What customers ask:** "Tournament not showing" / "Data is stale" / "Scores not updating"
**Resolution:** Troubleshoot cache, guide refresh, check sync status
**Agent action needed:** Check sync status, guide customer

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getTournamentDetail(tourn_id)` | Tournament details | Read | Does tournament exist? |
| `getTournamentList()` | List tournaments | Read | Is it in the list? |
| `getTlinkTeamStatus(usr_id, team_id)` | TennisLink sync status | Read | Last sync time |
| `updateTlinkTeamStatus()` | Update sync status | **Write** | Force re-sync |
| `getUSTAstatuses()` | USTA member status cache | Read | Is USTA data current? |

**Already built in support app:**
- Decision tree: "Data Caching" (87 chats, 43 nodes)
- KB entries for refresh instructions

**What to build:**
- Show "Last synced: X hours ago" in context panel
- One-click "Force Refresh" (calls `updateTlinkTeamStatus()`)
- Platform-specific refresh instructions (MTA vs MTT)

---

### #8. Tournament Setup / Config (8% | 18.3 min avg)

**What customers ask:** "How to set up a tournament" / "Can't create flights" / "Config issue"
**Resolution:** Complex — usually requires admin guidance or intervention
**Agent action needed:** View tournament config, guide setup, possibly modify

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getTournamentDetail(tourn_id)` | Full tournament details | Read | View current config |
| `getTournamentDivisions(tourn_id)` | Tournament divisions | Read | See division structure |
| `getTournamentDrawFlights()` | Flights + team counts | Read | See flight setup |
| `getTournFlightTeamsByTournFlightID()` | Teams in flight | Read | Which teams in which flight? |
| `getTournSitesList()` | Venues | Read | Tournament venues |
| `getTournScheduleList()` | Schedules | Read | Match scheduling |
| `insertTournament()` | Create tournament | **Write** | New tournament setup |

**Already built in support app:**
- Decision tree: "Tournament Setup/Config" (84 chats, 76 nodes)

**What to build:**
- Tournament detail viewer in context panel (when tournament ID detected)
- Show division/flight structure visually
- Link to CMS admin tournament page for edits

---

### #9. Draw / Roster Checks & Eligibility (8% | 10.4 min avg)

**What customers ask:** "Is my player eligible?" / "Draw is wrong" / "Roster issue"
**Resolution:** Check player eligibility, verify draw, fix roster
**Agent action needed:** Look up player/team eligibility

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getTournTeamMembers(team_id)` | Full team roster | Read | Who's on the team? |
| `getTournTeamCaptainByTeam(team_id)` | Team captain | Read | Who's the captain? |
| `getCompetitorRecordsByPlayer(player_id)` | Player's competitor entries | Read | Eligibility status |
| `getPlayerRecord(player_id)` | Player profile + ratings | Read | NTRP/UTR rating check |
| `getUSTAMemberActive(authToken)` | USTA membership active? | Read | Membership verification |
| `getSafePlayStatus(authToken)` | Safe Play certified? | Read | Safety compliance check |
| `removeTeamFromTournFlight()` | Remove team from flight | **Write** | Fix draw error |
| `removeUserFromTournTeam()` | Remove player from team | **Write** | Fix roster |

**Already built in support app:**
- Decision tree: "Draw/Roster Checks" (79 chats, 52 nodes)

**What to build:**
- Team roster viewer with eligibility status per player (USTA active, Safe Play, rating)
- Eligibility checklist: USTA [x], Safe Play [x], Rating [x], Waiver [x]

---

### #10. Subscription / Payment Issues (7% | 6.3 min avg)

**What customers ask:** "Charge me twice" / "Can't upgrade" / "Cancel subscription"
**Resolution:** Check subscription, view transactions, process changes
**Agent action needed:** View billing, make changes

| CMS Service | What It Does | Read/Write | Use Case |
|-------------|-------------|------------|----------|
| `getStripeSubscription()` | Current subscription details | Read | What plan? Active? |
| `getStripeSubsInfoBySubsID()` | Lookup by Stripe sub ID | Read | Detailed sub info |
| `getUserProductOrderList(usr_id)` | All orders | Read | Purchase history |
| `getTransactionList(array)` | Payment transactions | Read | Payment history + failures |
| `cancelStripeSubscription()` | Cancel subscription | **Write** | Process cancellation |
| `setStripeSubscription()` | Create/modify subscription | **Write** | Upgrade/downgrade |
| `updateUserStatus()` | Change subscription tier | **Write** | Status change |
| `insertCouponsInd()` | Apply discount code | **Write** | Retention offer |
| `getDiscountCodesList(params)` | Available discounts | Read | What codes exist? |
| `moveOrderToOtherUser()` | Transfer order | **Write** | Wrong account charged |
| `checkStripeCustomerData()` | Verify Stripe customer | Read | Data consistency check |

**Already built in support app:**
- Customer lookup shows subscription type + expiry
- Decision tree: "Subscription/Payment" (77 chats)

**What to build:**
- Transaction history viewer in context panel
- Subscription management buttons (cancel, upgrade, apply discount)
- Failed payment alert with card status

---

## Universal CMS Services (Used Across All Issues)

| CMS Service | What It Does | Read/Write | Used By |
|-------------|-------------|------------|---------|
| `getUserDetail(usr_id)` | Complete user profile | Read | All issues — primary lookup |
| `getPlayerRecord(player_id)` | Player profile + ratings | Read | Player-related issues |
| `getUserOrgMemberList(usr_id)` | User's organizations | Read | Team/org context |
| `getUserTeamMemberList(usr_id)` | User's teams | Read | Team context |
| `getUserLogs()` | Activity history | Read | Troubleshooting |
| `getLoginAttemptForUser()` | Failed login count | Read | Account access issues |
| `getUserCommHistoryList()` | Communication history | Read | Previous support context |
| `searchAll()` | Global search | Read | Finding anything |

---

## Write Actions Summary (Agent Capabilities)

These are the CMS methods that **modify data** — the ones that enable one-click resolutions:

| Action | CMS Method | Risk Level | Confirmation Needed? |
|--------|-----------|------------|---------------------|
| Unlock account | `removeLoginAttemptForUser()` | Low | No — always safe |
| Send password reset link | `generateResetPasswordLink()` | Low | No — already built |
| Update single profile field | `updateFormSingleData()` | Medium | Yes — show before/after |
| Link player to account | `addPlayerRelationToUser()` | Medium | Yes — confirm correct player |
| Unlink player from account | `removePlayerRelationFromUser()` | Medium | Yes — confirm removal |
| Merge duplicate accounts | `mergeIntoOtherUser()` | **High** | Yes — double confirm |
| Cancel subscription | `cancelStripeSubscription()` | **High** | Yes — double confirm |
| Apply discount code | `insertCouponsInd()` | Medium | Yes — confirm code + amount |
| Create new player | `insertPlayer()` | Medium | Yes — confirm details |
| Force data refresh | `updateTlinkTeamStatus()` | Low | No — safe operation |
| Update match/lineup | `updateMatch()` / `deleteMatchPlayer()` | **High** | Yes — show changes |
| Change subscription tier | `updateUserStatus()` | **High** | Yes — double confirm |

---

## Integration Architecture (Proposed)

```
Support Dashboard (Next.js)
    │
    ├─ Existing: MySQL direct queries (read-only customer lookup)
    │   └─ src/lib/db/mysql.ts (MTA + MTT pools)
    │
    └─ New: CMS API integration (read + write operations)
        └─ src/lib/cms/client.ts (proposed)
            ├─ Base URL: [from CMS config]
            ├─ Auth: JWT token
            ├─ Methods: typed wrappers around CMS services
            └─ Used by: new API routes for agent actions
```

**Key decision:** We're calling the CMS API (Matt's web services) rather than writing our own MySQL queries for write operations. This ensures business logic (validation, side effects, logging) stays in one place.
