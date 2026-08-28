/**
 * Spoken notes for the prototype video. Run: npm run talk
 * userschema.js is the interview-board version and is not imported here on purpose.
 */

function section(title: string, lines: string[]): void {
  console.log(`\n## ${title}\n`);
  for (const line of lines) console.log(`- ${line}`);
}

section('What this prototype is', [
  'Post-match reward engine. Duel play is upstream. This component subscribes to match completed.',
  'Single process, in-memory store, behind interfaces. Queue, lock, and ledger can move to Redis/Postgres without changing rule functions.',
  'Domain is pure: given an ordered match log, evaluate the three rules. No Date.now inside the rules.',
]);

section('Schema vs userschema.js', [
  'Match carries result. Without result, rule 1 cannot exist.',
  'timeInterval is a number, the logical clock. Streak order is ORDER BY timeInterval, never HTTP arrival, never created_at.',
  'Rewards are a grant ledger with an idempotency key, not a naked coins integer that we increment in the rule body.',
  'userschema.js had rmatch, nested functions, and GameInterval unused by any rule. Those fields are not in this schema because no rule reads them.',
]);

section('The three rules', [
  'Rule 1: consecutive wins at the end of the ordered log, any game type. Grant 50 coins when streak is 3, 6, 9. Scope is the user. Memory win and math loss share one streak.',
  'Rule 2: count matches whose dayKey equals the triggering match. Grant one loot box when the count hits exactly 5. Once per day.',
  'Rule 3: algebra wins inside [t - 1h, t]. Second win activates combo multiplier 2 for the next hour. Already-active combo is not re-granted.',
]);

section('T0: two threads after Lost, Win, Win', [
  'Only two HTTP calls at T0: one win (111, t=1235) and one loss (2, t=1236). History Lost, Win, Win is already in the DB, not a request.',
  'Both lock userId 123. Thread B waits until thread A finishes applyLocked. That is the mutex. It does not pick the winner by who arrived first.',
  'After both apply, the log is ordered by timeInterval. Win 111 is the third consecutive win, so 50 coins. The loss is later, live streak becomes 0, coins stay.',
]);

section('If we had locked matchId instead', [
  '111 and 2 take different locks and both enter. Snapshot is stale. Lost update on user state.',
  'Worse case: two concurrent 3rd wins both grant 50. Demo prints 100 vs 50. That is why matchId is the wrong grain.',
  'matchId lock only serializes retries of the same match. Rule 1 mutates user streak. Lock the user.',
]);

section('Advantages of this prototype over userschema.js', [
  'It runs. userschema.js is not valid JavaScript: `let ,match`, `match gametype`, nested functions, unfinished `db.`.',
  'Rule 1 here counts consecutive wins. userschema.js counts gametype == "single" inside `for i < matchid`, which is not the rule.',
  'Rule 2 here counts five matches in a day. userschema.js checks a timestamp range and inserts a loot box with no count.',
  'Rule 3 here is two algebra wins in 1h. userschema.js hardcodes matchid == 2.',
  'Idempotency: UNIQUE matchId plus grant keys. userschema.js would insert on every retry.',
  'Concurrency: per-user mutex. userschema.js has no lock, so the T0 question is undefined.',
  'Rules are data plus pure functions. Adding a 4th rule does not copy-paste another db.query into the ingest handler.',
]);

section('Disadvantages / time-box compromises of this prototype', [
  'In-memory lock dies across pods. Real version: partition by userId so all of 123 lands on one worker, or SELECT FOR UPDATE on player_reward_state.',
  'No durable database. Process restart loses matches and grants. Real version: matches table UNIQUE(matchId), grants table UNIQUE(userId, ruleId, key).',
  'Day is floor(timeInterval / 86400000), UTC. Player timezone is the honest product answer and is not built.',
  'Combo duration is assumed to be 1 hour. The statement only said activate. Flag that in the video.',
  'Loot box is once per day at 5, not every 5 matches. Also an assumption.',
  'Ingest is HTTP POST /matches. Production trigger is EventBus duel:completed from the owning duel pod, not a client-facing match API.',
  'Combo does not multiply the coin grant on the same match that activated it. That ordering is deliberate and should be said out loud.',
]);

section('Disadvantages of userschema.js that are not just "it does not compile"', [
  'Locking on match inside that file would still be the wrong grain if it were added, because the shared row is the user.',
  'Coins and Lotterybox are balances without a ledger, so you cannot audit which rule paid or replay a grant.',
  'Hardcoded matchid == 2 cannot survive two different algebra matches.',
  'No result field, so the first rule in the problem statement is unrepresentable.',
]);

section('Say out loud at the end', [
  'Single-process to fit the time box. Domain testable without HTTP. Multi-pod difference is the lock and the match log, not the rule functions.',
  'The T0 answer is: lock user 123, unique match 2, order by timeInterval. Not whichever API hit first.',
]);
