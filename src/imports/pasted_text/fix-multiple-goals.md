Edit the existing app prototype and fix the goal logic. **Keep the entire existing UI design, screens, layouts, colors, fonts, spacing, components, text, and styling exactly as they are. Do not redesign anything. Only fix the goal functionality and flow described below.**

### 1. Multiple Goals — IMPORTANT

The user must be able to create **multiple goals**, not only one goal.

There should be NO limitation of one goal per user.

The user can:

* Create a first goal during onboarding.
* Later go to the Goals screen and click **Add Goal** to create additional goals.
* Continue adding as many goals as needed.

All created goals should remain available unless the user removes them.

### 2. First Goal During Onboarding

The onboarding flow should remain:

**Login → Onboarding OR Skip → Set Your First Goal → Enter Goal Information**

When the user creates this first goal:

* Automatically create the goal.
* Automatically make it active.
* Save it in the Goals screen.
* Show it on the Home screen.
* Make this first goal the **default selected goal** displayed in the Home Goal Card.

The user should NOT need to manually activate this first goal.

### 3. Home Goal Card

There is ONE main Goal Card on the Home screen.

The card should display **one selected goal at a time**.

If the user has multiple goals:

* All goals remain available.
* The user can choose which goal should be displayed in the Home Goal Card.
* Changing the selected goal in the card must NOT delete, deactivate, or remove the other goals.
* The other goals must remain available in the Goals screen and Home goals list.

The goal created during onboarding should be selected by default initially.

### 4. Multiple Goals on Home + Goals Screen

Every active goal created by the user should be available:

* In the Goals screen.
* In the Home screen's goals area/list.
* And any one of them can be selected to appear in the main Goal Card.

Creating a new goal must NOT replace or delete existing goals.

Example:

Goal A → created during onboarding → appears in Goals + Home → selected in main card

Then:

Goal B → created from Add Goal → appears in Goals + Home

Then:

Goal C → created from Add Goal → appears in Goals + Home

All three goals remain available.

The user can choose:
**Goal A OR Goal B OR Goal C**
to display in the main Home Goal Card.

### 5. Add Goal

The user must be able to add a new goal at any time from the Goals screen.

Flow:

**Goals → Add Goal → Enter Goal Information → Create Goal**

After creating a new goal:

* Add it to the existing Goals screen.
* Add it to the Home screen goals.
* Keep all previously created goals.
* Do not replace or delete existing goals.
* The newly created goal can become the selected goal in the main card if appropriate, but all other goals must remain available.

### 6. Edit Goal

Every created goal should have an Edit option.

The user can edit:

* Goal name
* Goal amount
* Goal time / duration / target date
* Other existing goal information

When editing:

* Update the SAME goal.
* Do NOT create a duplicate.
* Do NOT delete the goal.
* The updated information must appear immediately in both the Goals screen and Home screen.

Important:
If the user edits a goal and then navigates to Home and back to Goals, the goal must still exist with the updated information.

### 7. Remove / Deactivate Goal

If the user removes or deactivates a goal:

**For manually created goals:**

* Remove the goal from the Goals screen.
* Remove the goal from the Home screen.
* Remove it from the available goals for the Home Goal Card.
* It should no longer appear anywhere.

**For built-in/predefined goals:**

* Do NOT permanently delete the built-in goal.
* Deactivating it should make it inactive.
* Remove it from the active goals shown on Home.
* Keep it available in the Goals screen as an inactive built-in goal.
* Show an **Activate** option so the user can activate it again later.

### 8. Activation

When the user activates an inactive built-in goal:

* Make it active immediately.
* Show it in the Goals screen as active.
* Show it in the Home screen goals.
* Make it available to select for the main Home Goal Card.
* Do NOT remove or replace any other active goals.

Multiple goals can be active at the same time.

### 9. No Goals State

If the user has **zero active goals**, the Home Goal Card must NOT display a random goal, placeholder goal, or any unrelated content.

Instead, show only:

**“No goals”**

with an action:

**“Start a new goal”**

Clicking **Start a new goal** should take the user to the goal creation flow.

### 10. Selected Goal vs Active Goals

IMPORTANT: The goal displayed in the main Home Goal Card is only the **selected/displayed goal**.

It does NOT mean that other goals are inactive.

For example:

* Goal A = Active
* Goal B = Active
* Goal C = Active
* Goal A = selected for the Home Card

Goal B and Goal C must still remain active and visible in the Goals/Home goals list.

The Home Card selection is only a display preference.

### 11. Final Goal Logic

Use this exact logic:

**First Goal:**

Onboarding → Create Goal → Automatically Active → Goals + Home → Selected in Main Card

**Additional Goals:**

Goals → Add Goal → Create → Active → Goals + Home → Available for Card Selection

**Edit:**

Edit Goal → Update Same Goal → Remains in Goals + Home

**Remove Manual Goal:**

Remove → Gone from Goals + Home

**Deactivate Built-in Goal:**

Deactivate → Inactive → Removed from Active Home Goals → Still available in Goals → Can Activate Again

**Multiple Active Goals:**

Goal A + Goal B + Goal C can all be active simultaneously.

**Main Home Card:**

User can choose which active goal is displayed in the main card.

**Zero Active Goals:**

Home Card → “No goals” + “Start a new goal”

### VERY IMPORTANT

Do NOT implement a one-goal-only system.

Do NOT replace existing goals when creating a new goal.

Do NOT remove other goals when selecting one goal for the Home Card.

Do NOT make the selected Home Card goal the only active goal.

Do NOT lose goals when navigating between Home and Goals screens.

Keep all existing UI and design unchanged. Only correct the goal data, state, navigation, activation, editing, removal, multiple-goal, and Home Card selection behavior described above.
