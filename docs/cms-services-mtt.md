# MTT CMS Web Services Reference — Match Tennis Team

> Living document. Maps the MatchTennisTeamWeb CMS web services to MTT support issues.
> CMS repo: `/Users/heathwatersnew/Projects/MatchTennisTeamWeb/`
> Database: `teammgmt` at sql1.teammgmtsolutions.com
> Total: 615+ methods across 45+ PHP classes
> Last updated: 2026-03-21

---

## Architecture

```
API Base URL: https://www.athleticsolutionstech.com/baseapp/service/apiV2/api/v1/
Auth: JWT Bearer token (same pattern as MTA)
Routing: POST /api/v1/{ClassName}/{methodName}/
```

**Key Classes:**
| Class | Methods | Focus |
|-------|---------|-------|
| AdminMain | 103 | Core admin: orgs, tournaments, users, teams, matches |
| AdminTask | 145 | Data manipulation, deletions, search, waivers, competitors |
| Draws | 98 | Draw generation, scheduling, brackets, court assignment |
| Stripe | 26 | Payment processing, refunds, connected accounts |
| Broadcast | 20 | Push notifications, mass messaging, email campaigns |
| Tournament | 19 | Reporting, team contacts, member insertion |
| Store | 19 | Orders, receipts, camp registrations |
| USTA | 16 | TennisLink API, player search, NTRP, Safe Play |
| Registration | 14 | App accounts, device validation, subscriptions |

---

## Top MTT Support Issues vs Available CMS Services

### #1. Team Registration (12% of chats | MTT-specific)

**What customers ask:** "Can't register team for tournament" / "Team not showing in flight" / "Captain invite not working"
**Resolution:** Check team registration status, payment, flight placement, captain role
**Note:** Serve Sync is MTA-only (see cms-services-mta.md). MTT registration is about team-level enrollment.

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getTournTeamsList(tourn_id)` | AdminMain | All teams in tournament | Read |
| `getTournTeamDetail(team_id)` | AdminMain | Team details | Read |
| `getTournTeamParticipants(team_id)` | AdminMain | Team roster in tournament | Read |
| `getTournTeamCaptainByTeam(team_id)` | AdminMain | Team captain | Read |
| `getTournFlightTeamsByTournFlightID()` | AdminMain | Teams per flight | Read |
| `getUserProductOrderList(usr_id)` | AdminMain | Payment/order history | Read |
| `getCompetitorRecordsByPlayer(player_id)` | AdminTask | Competitor entries | Read |
| `getCompetitorsByTournament()` | AdminTask | All competitors in tournament | Read |
| `getApplicantsByTournament(array)` | AdminTask | Pending applications | Read |
| `insertMemberToTeam()` | Tournament | Add member to team | **Write** |
| `insertMemberToTournPart()` | Tournament | Add to tournament participation | **Write** |
| `insertUserToTournPart()` | AdminTask | Register for tournament | **Write** |
| `saveTeamToFlight()` | Draws | Assign team to flight | **Write** |

**One-click actions:**
- Check team registration status (roster + payment + flight)
- Add missing member to team
- Assign team to correct flight

---

### #2. Lineup / Match Card Editing (12% | 123 MTT chats)

**What customers ask:** "Need to change lineup" / "Match card wrong" / "Wrong players listed"
**Resolution:** View match card, edit lineup, swap players

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getTeamTournMatchCard()` | Draws | Team's match card | Read |
| `getMatchCard()` | Draws | Generic match card | Read |
| `getTeamMatchCard()` | Draws | Team match card variant | Read |
| `getTeamTournMatchUpList()` | AdminMain | Upcoming matchups | Read |
| `getIndMatchParticipantsList()` | AdminMain | Players in match | Read |
| `getIndMatchList()` | AdminMain | Individual matches | Read |
| `switchMatchPlayerOrder()` | AdminTask | Swap player positions | **Write** |
| `deleteMatchPlayer()` | AdminTask | Remove player from match | **Write** |
| `updateTournMatch()` | Draws | Modify match | **Write** |
| `completeTournMatchup()` | Draws | Mark matchup complete | **Write** |
| `validateSubmittedLineup()` | DrawsExtra | Validate lineup submission | Read |
| `cancelSubmitLineup()` | DrawsExtra | Cancel submitted lineup | **Write** |
| `resetApprovedTeamLineupToPending()` | DrawsExtra | Reset lineup to pending | **Write** |
| `resetIndMatchUpsMatch()` | AdminMain | Reset matchups | **Write** |
| `fixMatchesParticipants()` | AdminMain | Repair participant data | **Write** |

**One-click actions:**
- View current match card
- Swap player positions in lineup
- Reset lineup to pending for re-submission

---

### #3. Tournament Setup / Config (8% | 82 MTT chats)

**What customers ask:** "How to set up tournament" / "Flight creation" / "Division config"
**Resolution:** View tournament config, guide setup, modify settings

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getTournamentDetail(tourn_id)` | AdminMain | Full tournament details | Read |
| `getTournamentRecord(tourn_id)` | AdminTask | Complete tournament record | Read |
| `getTournamentDivisions(tourn_id)` | AdminMain | Division structure | Read |
| `getTournamentDrawFlights()` | AdminMain | Flights + team counts | Read |
| `getTournFlightTeamsByTournFlightID()` | AdminMain | Teams per flight | Read |
| `getTournSitesList()` | AdminMain | Tournament venues | Read |
| `getTournSiteCourts(tourn_id, site_id)` | AdminMain | Courts at venue | Read |
| `getTournScheduleList()` | AdminMain | Match schedules | Read |
| `calculateTournCourtsUtilization()` | Draws | Court utilization stats | Read |
| `getTournSiteUtilizationSummary()` | Draws | Site utilization | Read |
| `insertTournament()` | AdminTask | Create tournament | **Write** |
| `insertTournSiteCourt()` | SiteCourts | Add court | **Write** |
| `generateTournamentDateTime()` | Draws | Generate schedule dates | **Write** |
| `createTournMatchUps()` | Draws | Generate matchups | **Write** |

**One-click actions:**
- View tournament structure (divisions, flights, teams, venues)
- View court utilization report
- Link to CMS for config changes

---

### #4. Draw / Roster Checks & Eligibility (8% | 63 MTT chats)

**What customers ask:** "Is player eligible?" / "Draw is wrong" / "Roster problem"
**Resolution:** Check eligibility, verify draw, fix roster

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getTournTeamMembers(team_id)` | AdminMain | Full team roster | Read |
| `getTournTeamCaptainByTeam(team_id)` | AdminMain | Team captain | Read |
| `getTournTotalTeamParticipants()` | Tournament | Total participants | Read |
| `getTeamParticipantContact()` | Tournament | Contact for participant | Read |
| `getCompetitorRecordsByPlayer(player_id)` | AdminTask | Player's entries | Read |
| `getPlayerRecordsByPlayerUstaID(ustaID)` | AdminTask | USTA lookup | Read |
| `getUSTAMemberActive(authToken)` | USTA | USTA membership active? | Read |
| `getSafePlayStatus(authToken)` | USTA | Safe Play certified? | Read |
| `checkNTRPrating()` | USTA | NTRP rating check | Read |
| `getTournFlightStandings()` | Draws | Flight standings | Read |
| `getTournTeamWinLossStanding()` | Draws | Team win/loss record | Read |
| `removeTeamFromTournFlight()` | AdminMain | Remove from flight | **Write** |
| `removeUserFromTournTeam()` | AdminMain | Remove from team | **Write** |
| `saveTeamToFlight()` | Draws | Assign team to flight | **Write** |
| `assignTeamToNextFlight()` | Draws | Move to next flight | **Write** |

**One-click actions:**
- Eligibility checklist: USTA active [x], Safe Play [x], NTRP [x], Waiver [x]
- View team standings
- Move team between flights

---

### #5. Password Reset / Account Lockout (10% | 65 MTT chats)

**What customers ask:** "Can't log in" / "Account locked" / "Reset password"

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getLoginAttemptForUser()` | AdminMain | Failed login count | Read |
| `removeLoginAttemptForUser()` | AdminMain | Clear failed logins | **Write** |
| `generateResetPasswordLink()` | AdminMain | Create reset URL | **Write** |
| `generateResetPasswordURL()` | AdminMain | Generate reset URL | **Write** |
| `updatePass()` | AdminTask | Change password | **Write** |
| `validate(email)` | ResetPass | Validate reset request | Read |
| `getUsrID()` | ResetPass | Lookup user by email | Read |

**One-click actions:**
- Show failed login count + lock status
- Unlock account (clear login attempts)
- Send password reset link

---

### #6. Feature How-To / Walkthroughs (14% | 78 MTT chats)

**What customers ask:** "How do I manage my team?" / "How to submit scores?"
**Resolution:** KB answer + guided steps

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| N/A — resolved from KB | - | 49 MTT KB entries | Read |
| `getTeamTournMatchCard()` | Draws | Show match card (for demos) | Read |
| `getTournStandingsDisplay()` | Draws | Show standings (for demos) | Read |
| `getTournBracketDisplay()` | Draws | Show bracket (for demos) | Read |

**One-click actions:**
- Send matching KB answer
- Show relevant tournament data as visual aid

---

### #7. Data Caching / Tournament List Refresh (8% | 34 MTT chats)

**What customers ask:** "Tournament not showing" / "Data stale" / "Scores not updating"

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getTlinkTeamStatus(usr_id, team_id)` | AdminMain | Last sync time | Read |
| `updateTlinkTeamStatus()` | AdminMain | Force re-sync | **Write** |
| `getUSTAstatuses()` | USTA | USTA cache status | Read |
| `getUSTAstatusesCron()` | USTA | Trigger USTA refresh | **Write** |
| `getTournamentList()` | AdminMain | Tournament list | Read |
| `getTournamentDetail(tourn_id)` | AdminMain | Verify tournament exists | Read |

**One-click actions:**
- Show "Last synced: X hours ago"
- Force TennisLink re-sync
- Trigger USTA status refresh

---

### #8. Subscription / Payment Issues (7% | 38 MTT chats)

**What customers ask:** "Charged twice" / "Refund" / "Can't pay for tournament"

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getStripeSubscription()` | AdminTask | Subscription details | Read |
| `getUserProductOrderList(usr_id)` | AdminMain | All orders | Read |
| `getAllCharges()` | Stripe | All Stripe charges | Read |
| `getIndCharge()` | Stripe | Single charge details | Read |
| `getCardOnFile()` | Stripe | Saved payment method | Read |
| `checkTournPayment()` | Store | Tournament payment status | Read |
| `getUnPaidCountByTournament()` | Tournament | Unpaid registrations | Read |
| `createRefund()` | Stripe | Full refund | **Write** |
| `createPartialRefund()` | Stripe | Partial refund | **Write** |
| `updateOrdersRefund()` | Stripe | Mark order refunded | **Write** |
| `processStripe()` | Stripe | Process payment | **Write** |
| `insertCouponsInd()` | AdminTask | Apply discount | **Write** |
| `getDiscountCodesList()` | AdminTask | Available discounts | Read |

**One-click actions:**
- View payment history + card on file
- Process refund (full or partial)
- Apply discount code
- Check tournament payment status

---

## Universal MTT Services (Used Across All Issues)

| CMS Service | Class | What It Does | R/W |
|-------------|-------|-------------|-----|
| `getUserDetail(usr_id)` | AdminMain | Complete user profile | Read |
| `getRelatedUsers()` | AdminMain | Connected accounts | Read |
| `getUserTeamMemberList(usr_id)` | AdminMain | User's teams | Read |
| `getUserTeamTournList(usr_id)` | AdminMain | User's tournament teams | Read |
| `getUserCommHistoryList()` | AdminMain | Communication history | Read |
| `getLoginAttemptForUser()` | AdminMain | Failed login count | Read |
| `searchAll()` | AdminMain | Global search | Read |
| `searchResultsLookup()` | AdminTask | Multi-field search | Read |
| `getLogsList()` | AdminTask | Activity logs | Read |
| `getTournamentByTournamentID(id)` | AdminTask | Quick tournament lookup | Read |

---

## Write Actions Summary (Agent Capabilities)

| Action | CMS Method | Class | Risk | Confirm? |
|--------|-----------|-------|------|----------|
| Unlock account | `removeLoginAttemptForUser()` | AdminMain | Low | No |
| Send reset link | `generateResetPasswordLink()` | AdminMain | Low | No |
| Force data sync | `updateTlinkTeamStatus()` | AdminMain | Low | No |
| Add member to team | `insertMemberToTeam()` | Tournament | Medium | Yes |
| Register for tournament | `insertUserToTournPart()` | AdminTask | Medium | Yes |
| Swap lineup players | `switchMatchPlayerOrder()` | AdminTask | Medium | Yes |
| Remove player from match | `deleteMatchPlayer()` | AdminTask | Medium | Yes |
| Reset lineup | `resetApprovedTeamLineupToPending()` | DrawsExtra | Medium | Yes |
| Move team to flight | `saveTeamToFlight()` | Draws | Medium | Yes |
| Apply discount | `insertCouponsInd()` | AdminTask | Medium | Yes |
| Process refund | `createRefund()` | Stripe | **High** | Yes (double) |
| Partial refund | `createPartialRefund()` | Stripe | **High** | Yes (double) |
| Change password | `updatePass()` | AdminTask | **High** | Yes (double) |
| Delete user data | `deleteUserAllDataAndArchive()` | AdminMain | **High** | Yes (double) |

---

## MTT-Specific Features (Not in MTA)

| Feature | Class | Methods |
|---------|-------|---------|
| **Draw generation** | Draws | `createMatchUps()`, `generateRRprelimUnflighted()`, `roundRobinPositionSelect()` |
| **Bracket display** | Draws | `getTournBracketDisplay()` |
| **Court assignment** | Draws | `setMatchCourt()`, `assignCourtsFilteredList()`, `getSitesMatchSlots()` |
| **Live scoring** | Draws | `getPlayerScores()`, `getOnCourtMatches()` |
| **Team standings** | Draws | `getTournFlightStandings()`, `getTournTeamWinLossStanding()` |
| **Captain messaging** | Draws | `sendCaptainTextMessageByTeamId()`, `sendTeamCourtAssignMessage()` |
| **Lineup validation** | DrawsExtra | `validateSubmittedLineup()`, `cancelSubmitLineup()` |
| **Tournament reports** | Tournament | `getTournamentEntriesReport()`, `getSportsmanshipAwardReport()`, `getTeamSummaryReport()` |
| **Refund processing** | Stripe | `createRefund()`, `createPartialRefund()` |
| **Connected accounts** | Stripe | `processStripeConnectedCharge()`, `processStripeAppFeeConnectedAcct()` |
| **Co-captain management** | DrawsExtra | `changeToCoCaptain()` |

---

## MTT vs MTA Overlap

Both CMS repos share these core patterns:
- `getUserDetail()` / `getLoginAttemptForUser()` / `removeLoginAttemptForUser()`
- `generateResetPasswordLink()` / `updatePass()`
- `getCompletedWaiversByUser()` / `getWaiverDetail()`
- `getUserProductOrderList()` / `getStripeSubscription()`
- `searchAll()` / `searchDuplicateUSTAUsers()`
- `getTlinkTeamStatus()` / `updateTlinkTeamStatus()`

**Key difference:** MTT has specialized `Draws` class (98 methods) for tournament bracket/schedule management that MTA does not have. MTA has AI scouting/analytics classes that MTT does not have.
