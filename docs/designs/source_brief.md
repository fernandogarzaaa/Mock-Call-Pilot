# Mock-call pilot: build brief for the building agent

<!-- Copy of the brief pasted into the build session on 2026-11-19. Verbatim except that the pilot lead's email address is omitted. Do not edit. -->

Date: Nov 19, 2026
Owner: Fernando Garza (Rhino Squad)
Pilot lead: Harold Carpentero, who scores every session manually
Prepared by: Cookie, for Fernando's other agent

This brief is self-contained. Do not assume any shared files, repos, tools, or prior context. Everything the build needs is in this document.

## Goal

Build a working pilot of an AI mock-call assessment system for Rhino Squad. One role, one test. A candidate completes a mock sales call against a scripted AI prospect. The AI writes in text. The candidate speaks. The audio is recorded and transcribed. When the candidate finishes, a shareable recording link is generated automatically so the candidate can paste it into their own Paid Test document.

Done means: a candidate can run the full mock call end to end, the audio and transcript are captured, and a recording link is produced at the end. Nothing more is promised.

## Pilot scope (settled, do not change)

- Text-based AI. The AI writes its lines in text. The candidate answers by voice.
- One role only: Can-Am Telematics prospecting, accidents path (see the script below).
- No AI scoring. Harold scores every session manually from the audio and transcript.
- Simultaneous sessions with no coordinator is the thing being proven, along with staying on script.
- Voice AI (the AI speaking) is phase 2, not this build.
- A booking system is only needed if candidates cannot complete the assessment inside the test window. That question is still open (see Gaps).

## The role and the script

Role: Can-Am Telematics prospecting. The candidate plays the caller. The AI plays the prospect (the fleet owner). The goal of the call is booking the 20-minute liability assessment. There is one prospect.

The script below is the full Can-Am Telematics Prospecting Call Script, as sent by the client. The pilot uses the accidents path only. The other option paths (Lost jobs, Growing pains) are not used in this pilot.

### Script

Call the highest-level decision-maker you can reach. Pick the 1 option below that fits them best.

Deadbolt 1: Get Their Attention

"[First Name?]..." (sound of familiarity, with a question like "Is this FNAME?" then pause)

"Who is this..."

"This is [Your First and Last Name with Can-Am]. I'm calling to Protect You..., your (Company Name) and Your Drivers from accidents that cause lawsuits."

If "I'm busy." / "This is a bad time."
"This will only take 30 seconds. If you're not interested in 30 seconds, I can stop. Sound good?"
Wait for "Okay." If not, move forward.

Deadbolt 2: Keep Their Attention

Option: Accidents and insurance

"I called because I was thinking about (Company Name) as I saw a billion-dollar lawsuit against another small business like yours..."

"AJD Business Services failed to audit and track crucial driver risk factors, and was liable for a billion... with a B... they lost that billion-dollar lawsuit... because they failed to audit and track crucial driver risk factors."

If they interrupt, let them know: "You'll want to hear this part... as it could save you much anguish..."

"We help you make sure that never happens to you or Company name..."

Information about the billion-dollar lawsuit: It was revealed that the driver had been using his cell phone and had a history of severe safety violations. The company did not actively monitor or intervene regarding his hours-of-service, phone data, or background qualifications.

Deadbolt 3: Leverage Their Attention

"Would you be opposed to a 20-minute liability assessment that gives you clarity, peace, and the confidence... so you know what to focus on, so you don't ever have to worry about being liable like AJD was for a billion dollars?"

"Even if you never work with us... this liability assessment can be used with your current telematics company to help them help you."

"Don't try to overcome objections, as everything circles back to Deadbolt #3 Liability Assessment."

"We need to think about it... Send some information... Any objection..."

"[First Name]... I understand you're busy, and I am too... I truly care about what I do and that's why I'm calling out of the blue... my intention is to help you, and a 20-minute conversation, COMPLIMENTARY LIABILITY ASSESSMENT, helps me help you and could save you years of grief and anguish in your business."

"Are you okay with scheduling just 20 minutes to eliminate future problems in your business?"

Deadbolt 4: Schedule the Meeting

"Great. Does [day and time] work, or is [day and time] better?"

"To save you time I'm sending the invite now while we're on the phone to make sure it doesn't go into the spam folder. Let me know when you see it."

Stay on the line until it's on both calendars. Until then, you don't have a meeting.

Fleet Size Check: Ask this right before Deadbolt 3 if the list doesn't already show it.

"[First Name], how many vehicles are you running right now?"
If it's 10 or more, keep going. If it's under 10, thank him and end the call.

Note: the under-10 path in the script pitches a 15-minute conversation instead of the 20-minute liability assessment. For this pilot, the prospect has 10 or more vehicles, so the call follows the main path. Do not build the under-10 branch.

Cold Voicemail and Follow-Up Email: the script includes a cold voicemail and a follow-up email (subject "Your Voice Message", claiming fleets cut accident rates 40% and fuel costs 14%). These are not part of the live mock call. Do not build them.

### How the AI should behave

- The AI plays the prospect, not the caller. It responds to the candidate's lines in character.
- It follows the Deadbolt flow: attention, lawsuit story, liability assessment pitch, two-option close.
- It stays on script. It must never promise anything the script does not promise, and never invent company facts, prices, or guarantees.
- Objections: the script has no objections section and says not to overcome objections. The AI needs to handle common pushback (too busy, not interested, already have telematics, send info, no budget, call back later) by acknowledging briefly and circling back to the liability assessment. The exact approved replies are pending Fernando's draft. Build the objection replies as a config list that can be dropped in later. Do not invent approved wording and present it as client-approved.
- The AI must never break character to explain itself, and never coach the candidate.

## Delivery: audio, transcript, recording link

- Record the candidate's audio for the whole call.
- Produce a transcript alongside the audio, so the client can read along when a candidate's accent is thick. (Harold scores from audio and transcript.)
- When the candidate finishes, generate the recording link automatically. The candidate pastes that link into their own Paid Test document. Each candidate gets their own Paid Test document. The link must be shareable and not access-restricted.
- The recording link is the deliverable the candidate submits. The pilot does not need a separate results dashboard.

## Candidate flow (as far as known)

- The candidate completes the mock call inside the test window. Whether they book a slot or just complete it inside the window is still open (see Gaps).
- The candidate sees the task instructions, then starts the call. The AI writes, the candidate speaks.
- The call ends when the candidate books the meeting (Deadbolt 4) or the prospect ends the call.
- After the call, the candidate gets the recording link and pastes it into their Paid Test document.

## Gaps: do not invent these

The following are still missing. Build the core so each one plugs in later as config. Do not guess, do not invent, and do not present a guess as a decision.

1. Interview flow, step by step, from booking to finish. The client has no documented process. Rhieza is asking them one last time.
2. Test window: dates, slot length, number of candidates, and whether candidates book a slot or just complete it inside the window.
3. Recording notice: the short message candidates see before the call starts, telling them the call is recorded, why, and how long recordings are kept. Whether Rhino's standard notice works, or the client has their own wording, is unanswered.
4. The role and which live test to copy it from, with the team's permission confirmed. (The role itself is Can-Am Telematics prospecting, but which live test it copies is unanswered.)
5. Short client details plus the task instructions the candidates get.

## Not in scope

- Retry or restart option for candidates. Rhieza asked for it. It is not confirmed. Do not build it. Note it as a possible future addition.
- AI scoring. Harold scores manually.
- Voice AI. Phase 2.
- Booking system, unless the test window answer requires it.
- The Cold Voicemail and Follow-Up Email from the script. Not part of the live call.
- The Lost jobs and Growing pains option paths. Accidents only.
- The under-10 fleet branch. The pilot prospect has 10 or more vehicles.
- Any cost figure, pricing page, or build date. Do not promise these to anyone.

## Constraints

- Keep it simple. The pilot proves two things: staying on script, and simultaneous sessions with no coordinator.
- No AI scoring anywhere in the build.
- The AI must never promise anything outside the script.
- Do not hardcode the missing items. Put them behind config or clearly marked placeholders that fail loudly if unset, so nothing ships with a guessed value.
- The recording link must work without a login for the client reviewer.

## What to return

- A working pilot the owner can run a test candidate through.
- A short note stating what was built, what is still blocked on the five gaps above, and what config values need to be supplied before the first real candidate runs it.
- No claim that the pilot is production ready. It is a pilot.
