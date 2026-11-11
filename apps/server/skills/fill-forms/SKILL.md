---
name: fill-forms
description: Fill in web forms such as sign-ups, applications, bookings and checkouts from what you know about the user, and stop for approval before anything is submitted or paid.
---

# Fill in forms

1. Open the form in your browser and take a snapshot. List every field it asks for, including
   ones on later pages if you can see them.
2. Find the answers in `AGENTS.md` and `memory/`. Do not guess. For anything you do not have
   (and for every password, card number or identity document number), ask the user, with all the
   missing fields in one message.
3. Fill the fields in order. After each page, take a snapshot and check that the values stuck and
   that the site shows no validation errors.
4. **Stop before the final step.** Do not press the button that submits, books, pays or confirms.
   Show the user a summary of what will be sent, and the total price if there is one, and wait
   for them to say yes.
5. After they approve, submit, then report the confirmation number or the message the site shows.
6. If the user gave you new details that will be useful again (an address, a membership number),
   save them to `memory/`. Never save passwords, card numbers or security codes.

## Rules

- If the site asks for a login, a CAPTCHA or a code sent to the user, ask them to do that step in
  the Browser panel.
- If the price, the terms or the form changes after the user approved, stop and ask again.
- One approval covers one submission.
