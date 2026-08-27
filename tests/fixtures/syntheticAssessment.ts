/**
 * A synthetic wheelchair assessment used for end-to-end verification.
 *
 * Written as unlabelled flowing text, exactly as the free device pipeline produces it: no
 * speaker tags, because the browser cannot supply them. Every element the acceptance
 * criteria require is present, and the expectations below name what the pipeline must do
 * with each.
 */

export const SYNTHETIC_TRANSCRIPT = `
Good morning, thanks for coming in. Before we start, is it alright if I make notes from our
conversation today? Yes that's fine. Lovely. So tell me what's brought you here now. Well the
main thing is I want to get back to taking my grandson to the park on a Saturday. I can't
manage it in the chair I've got. That's a really good goal to work towards. Tell me about the
chair you have at the moment. It's the one I got about six years ago, the self-propelling one,
and the seat's gone completely flat. It's too narrow as well, it catches my hips.

Can you tell me about your diagnosis? I've got multiple sclerosis, diagnosed in 2011, and it's
been getting slowly worse the last three years or so. And are you on any medication for it? Yes
but I'd have to check the names with my GP.

How about pain, do you get much? Yes, in my right hip mostly. It comes on after about an hour
of sitting and it's a burning sort of pain. It's been like that for about four months and it's
definitely worse than it was. Does it stop you doing anything? I don't go out for more than an
hour now because of it.

How far can you walk at the moment? About twenty metres indoors with my frame, on a good day.
Right. And have you had any falls? No, I haven't fallen at all, not for a long time. His wife
mentioned on the phone that he'd been down twice in the last fortnight, once in the bathroom.
Oh, well, those weren't proper falls.

How do you get from the chair to the bed? I do it myself, I stand and pivot round holding the
grab rail. That's good, that's an independent stand-pivot transfer.

Right, I'm going to have a look at your sitting position. If you can just sit as you normally
would for me. I can see there's a left pelvic obliquity there, about fifteen degrees. Let me
just see. Yes, that corrects almost fully when I support it, so that's flexible rather than
fixed. And the trunk lean to the right settles when the pelvis is supported.

I'll take some measurements. Seat width is forty four centimetres, measured in supported
sitting with your shoes on. Seat depth I'm making forty two centimetres.

How's the skin over your bottom, any soreness or redness? A bit red over the right side
sometimes, but it goes away. Do you shift your weight when you're sitting? I lean forward every
half hour or so, my wife reminds me.

Tell me about getting into the house. There's one step at the front door, about six inches, and
the bathroom door is quite narrow, I have to go in at an angle. And getting out and about? My
wife drives, we've got the car, but she can't lift the chair into the boot on her own any more.

Let's try you in this one. This is a lightweight rigid frame with a pressure-redistributing
foam cushion. How does that feel? That's much better actually, I feel like I'm sitting straight.
Good, and your propulsion looks a lot more efficient. I'd rather have the black frame than the
blue one if that's possible.

So my reasoning is that the flexible pelvic obliquity is driving the trunk lean and the right
hip pain, and a contoured cushion that supports the pelvis should address all three, while the
lighter frame deals with the car problem for your wife. We'll order the lightweight frame with
the pressure-redistributing cushion. I'll put that through this week.

I haven't checked your hand function properly today, we ran out of time, so we'll do that at
the review.

I'll see you again in six weeks once the chair arrives, and sooner if the skin gets any worse.
How does that sound? That sounds good, yes, I'm happy with that.
`.trim();

/** What the pipeline must demonstrably do with the transcript above. */
export const SYNTHETIC_EXPECTATIONS = {
  goal: 'taking his grandson to the park',
  wheelchairProblem: 'seat has gone flat and the chair is too narrow',
  medicalHistory: 'multiple sclerosis diagnosed 2011',
  pain: 'right hip, burning, after about an hour, four months, worsening',
  walkingDistance: '20 metres indoors with a frame',
  transferMethod: 'independent stand-pivot',
  postural: 'left pelvic obliquity approximately 15 degrees, flexible not fixed',
  laterality: 'left obliquity, right trunk lean, right hip pain',
  measurementCm: '44 cm seat width, 42 cm seat depth',
  pressure: 'intermittent right-sided redness; forward lean every 30 minutes',
  homeAccess: 'one 6 inch step at the front door; narrow bathroom door',
  transport: 'wife cannot lift the chair into the car boot',
  trial: 'lightweight rigid frame with pressure-redistributing foam cushion',
  preference: 'black frame rather than blue',
  reasoning: 'obliquity drives trunk lean and hip pain',
  action: 'order lightweight frame with pressure-redistributing cushion this week',
  followUp: 'review in six weeks, sooner if skin deteriorates',

  /** Both accounts must survive; neither may be chosen over the other. */
  contradiction: {
    a: 'no falls',
    b: 'down twice in the last fortnight'
  },

  /** Explicitly not done. Must never be rendered as a normal finding. */
  notAssessed: 'hand function'
};
