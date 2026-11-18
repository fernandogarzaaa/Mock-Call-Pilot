# Concepts brief: Mock-call pilot

Source: build brief "Mock-call pilot: build brief for the building agent", dated Nov 19, 2026,
prepared by Cookie for Fernando Garza (Rhino Squad). Pilot lead: Harold Carpentero, who scores
every session manually. Pasted into the session on 2026-11-19. This file condenses it as the
EGM concepts brief. The exact wording, including the full script, is in
[source_brief.md](source_brief.md); where the two differ, source_brief.md wins.

Unresolved reading: the brief says the AI plays the prospect, and also that "the AI needs to
handle common pushback ... by acknowledging briefly and circling back to the liability
assessment", which is the caller's move in the script. Whether the objection config holds the
prospect's pushback lines, the caller's reference replies, or both is an open question.

## Goal

A working pilot of an AI mock-call assessment for one role, one test. A candidate runs a mock
sales call against a scripted AI prospect. The AI writes its lines as text; the candidate
answers by voice. The audio is recorded and transcribed. When the candidate finishes, a
shareable recording link is generated automatically, and the candidate pastes it into their
own Paid Test document.

Done means: a candidate can run the full mock call end to end, the audio and transcript are
captured, and a recording link is produced at the end. Nothing more is promised.

What the pilot proves: (1) the AI stays on script, (2) many candidates can run sessions at the
same time with no human coordinator.

## Settled scope

- Text AI, voice candidate.
- One role: Can-Am Telematics prospecting, accidents path only.
- No AI scoring. Harold scores from audio + transcript.
- Voice AI (AI speaking) is phase 2.
- Booking system only if the test-window answer requires it (open).

## Role and script

The candidate is the caller. The AI is the prospect (fleet owner, 10+ vehicles). The call's
goal is booking the 20-minute liability assessment.

Script (accidents path), as sent by the client:

- **Deadbolt 1, Get their attention.** Caller: "[First Name?]..." Prospect: "Who is this..."
  Caller: "This is [Name] with Can-Am. I'm calling to Protect You..., your (Company Name) and
  Your Drivers from accidents that cause lawsuits." If "I'm busy" / "bad time": "This will only
  take 30 seconds. If you're not interested in 30 seconds, I can stop. Sound good?"
- **Deadbolt 2, Keep their attention (accidents and insurance).** The billion-dollar lawsuit
  story: AJD Business Services failed to audit and track crucial driver risk factors and lost a
  billion-dollar lawsuit. Background: the driver had been using his cell phone and had a history
  of severe safety violations; the company did not monitor hours-of-service, phone data, or
  background qualifications. If interrupted: "You'll want to hear this part... as it could save
  you much anguish..." Then: "We help you make sure that never happens to you or Company name..."
- **Fleet size check** (right before Deadbolt 3): "[First Name], how many vehicles are you
  running right now?" 10 or more: keep going. (Under-10 branch not built.)
- **Deadbolt 3, Leverage their attention.** "Would you be opposed to a 20-minute liability
  assessment...?" "Even if you never work with us... this liability assessment can be used with
  your current telematics company..." Do not overcome objections; everything circles back to
  the liability assessment. Any objection: "[First Name]... I understand you're busy... a
  20-minute conversation, COMPLIMENTARY LIABILITY ASSESSMENT, helps me help you..." "Are you
  okay with scheduling just 20 minutes to eliminate future problems in your business?"
- **Deadbolt 4, Schedule the meeting.** "Does [day and time] work, or is [day and time]
  better?" "I'm sending the invite now while we're on the phone... Let me know when you see it."
  Stay on the line until it's on both calendars.

Not built: under-10 branch, cold voicemail, follow-up email, Lost jobs and Growing pains paths.

## AI behaviour rules

- Plays the prospect, in character, responding to the candidate's lines.
- Follows the Deadbolt flow: attention, lawsuit story, liability assessment pitch, two-option
  close.
- Never promises anything the script does not; never invents company facts, prices, or
  guarantees.
- Raises common pushback (too busy, not interested, already have telematics, send info, no
  budget, call back later). Approved objection wording is pending Fernando's draft: build it as
  a config list to drop in later, and never present invented wording as client-approved.
- Never breaks character, never coaches the candidate.

## Delivery

- Record the candidate's audio for the whole call.
- Transcript alongside the audio (accents can be thick).
- Recording link generated automatically at the end; shareable with no login; candidate pastes
  it into their own Paid Test document.
- No results dashboard.

## Candidate flow (as known)

Task instructions → start call → AI writes, candidate speaks → call ends when the candidate
books the meeting (Deadbolt 4) or the prospect ends the call → candidate gets the recording link.

## Gaps (must be config or loud placeholders, never guessed)

1. Interview flow, booking to finish.
2. Test window: dates, slot length, candidate count, book-a-slot vs complete-in-window.
3. Recording notice wording and retention period.
4. Which live test the role copies, with permission confirmed.
5. Short client details and the candidate task instructions.

## Out of scope

Retry/restart (possible future), AI scoring, voice AI, booking system (unless gap 2 needs it),
voicemail/email, other option paths, under-10 branch, any cost figure, pricing page, or build
date.

## Return

A working pilot the owner can run a test candidate through, plus a short note: what was built,
what is blocked on the five gaps, which config values must be supplied before the first real
candidate. No production-ready claim.
