# ygocore-interface

**WIP** ygopro-core(https://github.com/moecube/ygopro-core) api wrapper

# Install

``` sh
npm install ygocore-interface
npm install ygocore           # for core engine
```

# How to use

``` typescript
import { engine } from 'ygocore';
import { Duel, DEFAULT_DUEL_OPTIONS } from 'ygocore-interface';
import { inspect } from 'util';

// initialize the engine, see http://github.com/ghlin/node-ygocore
//
// engine.registerCard(/* ... */);
// engine.registerScript(/* ... */);

// create the duel
const duel = new Duel(engine, {
  players: [
    /* player 1 */{ main: [ /* main deck */ ], extra: [ /* extra deck */ ] },
    /* player 2 */{ main: [ /* main deck */ ], extra: [ /* extra deck */ ] }
  ],
  seed: 0, /* random seed */
  options: DEFAULT_DUEL_OPTIONS /* master rule 4 */
});

while (true) {
  const todo = duel.step();

  if (todo.tag === 'DUEL_FINISHED') {
    if (todo.why.tag === 'REASON_WIN') {
      // the winner is:
      const winner = todo.why.message.player;
    }
    // duel finished.
    break;
  }

  if (todo.tag === 'ASK_QUESTION') {
    const playerResponse = await getResponse(todo.question.player, todo.question);
    duel.feed(playerResponse);

    console.log(`ask player ${todo.question.player} about: ${inspect(todo.question, false, null, true)}`}
    continue;
  }

  // todo.tag === 'DISPATCH_PACKET'
  for (const { whom, what } of todo.packets) {
    // message 'what' will be sent to player 'whom'
    await sendMessage(whom, what);
    console.log(`tell player ${whom}: ${inspect(what, false, null, true)}`);
  }
}

// end duel
duel.release();
```

Constants defined in `ocgcore/common.h` are also exported:

``` typescript
import { DUEL, LOCATION, POS, TYPE, QUERY, LINK_MARKER /* ... */ } from 'ygocore-interface';

// e.g. LOCATION.HAND => LOCATION_HAND (in common.h)
```

# TODOs

- [ ] A playable demo
- [ ] Handle response time-out
- [ ] TAG duel
- [ ] Parse replay file (.yrp)
- [ ] Type definitions for user response
- [ ] Documentation?

