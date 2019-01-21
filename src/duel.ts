import { isQuestionMessage, LOCATION, Message, MSG, MsgUpdateCard, MsgUpdateData, MsgWin, parseMessage, POS, QUERY, Question } from './coremsg';
import { OCGEngine } from './engine';

/**
 * there are packets to diliver.
 */
type STEP_DISPATCH_PACKET = 'DISPATCH_PACKET';
/**
 * ocgengine is asking a duelist a question.
 */
type STEP_ASK_QUESTION = 'ASK_QUESTION';
/**
 * duel finished.
 */
type STEP_DUEL_FINISHED = 'DUEL_FINISHED';

/**
 * player's operation timed out.
 */
type FINISHED_REASON_TIMEOUT = 'REASON_TIMEOUT';
/**
 * we've got a winner.
 */
type FINISHED_REASON_WIN = 'REASON_WIN';
/**
 * something went wrong.
 */
type FINISHED_REASON_ERROR = 'REASON_ERROR';

// reasons
interface ReasonTimeout {
  tag: FINISHED_REASON_TIMEOUT;
  player: number;
}
interface ReasonError {
  tag: FINISHED_REASON_ERROR;
  error: Error;
}
interface ReasonWin {
  tag: FINISHED_REASON_WIN;
  message: MsgWin;
}

export interface Packet<M> {
  /**
   * player id
   */
  whom: number;

  /**
   * the message
   */
  what: M;
}

/**
 * duel finished
 */
export interface DuelFinished {
  tag: STEP_DUEL_FINISHED;
  why: ReasonError | ReasonTimeout | ReasonWin;
}
/**
 * the engine says:
 */
export interface DispatchPacket {
  tag: STEP_DISPATCH_PACKET;
  /**
   * packets to be sent to players
   */
  packets: Array<Packet<Message>>;

  /**
   * the original message
   */
  original: Message;
}
/**
 * the engine wants to know:
 */
export interface AskQuestion {
  tag: STEP_ASK_QUESTION;
  /**
   * the engine is waiting for {@param question.player}'s answer (response)
   */
  question: Question;
}

export type StepResult = DuelFinished | DispatchPacket | AskQuestion;

export const DUEL_RULE_1 = 1 << 16;
export const DUEL_RULE_2 = 2 << 16;
export const DUEL_RULE_3 = 3 << 16;
export const DUEL_RULE_4 = 4 << 16;

/**
 * @see DUEL
 */
export const DEFAULT_DUEL_OPTIONS = DUEL_RULE_4;

const DEFAULT_LP = 8000;
const DEFAULT_START_HAND = 5;
const DEFAULT_DRAW_COUNT = 1;

/**
 * params for creating duel
 */
export interface CreateDuelParams {
  /**
   * players, should be of size 2
   */
  players: Array<{
    /**
     * main deck
     */
    main: number[];

    /**
     * extra deck
     */
    extra: number[];

    /**
     * initial LP, defaults to 8000
     */
    lp?: number;

    /**
     * how many cards to draw before duel starts, defaults to 5
     */
    start?: number;

    /**
     * how many cards to draw in each turn on DP, defaults to 1
     */
    draw?: number
  }>;

  /**
   * random seed
   */
  seed: number;

  /**
   * duel options, use DEFAULT_DUEL_OPTIONS if you have no idea.
   */
  options: number;
}

/**
 * single duel only
 *
 * (TAG duel is a TODO)
 */
export class Duel {
  private state: DuelState;

  constructor(engine: OCGEngine<{}>, params: CreateDuelParams) {
    this.state = createDuel(engine, params);
  }

  /**
   * feed player's response to this duel
   * @param response player's response
   * @returns false for invalid response, true otherwise
   */
  feed(response: Buffer) { return feed(this.state, response); }

  /**
   * like engine.process, see:
   *
   * @see StepResult
   *
   * @see DispatchPacket
   *
   * @see AskQuestion
   *
   * @see DuelFinished
   */
  step() { return step(this.state); }

  /**
   * finish the duel
   */
  release() { return this.state.engine.endDuel(this.state.duel); }
}

/**
 * helps pumping message
 */
class MessageQueue {
  private queue: Message[] = [];
  private index = 0;
  constructor(private pump: () => Message[]) { }

  get(): Message {
    this.fill();
    return this.queue[this.index++];
  }

  peek(): Message {
    this.fill();
    return this.queue[this.index];
  }

  private fill() {
    while (this.index === this.queue.length) {
      this.queue = this.pump();
      this.index = 0;
    }
  }
}

interface DuelState {
  engine: OCGEngine<any>;
  duel: any;
  queue: MessageQueue;

  pendingQuestion?: Question;
  finished?: DuelFinished;
}

/**
 * create & prepare for a duel
 * @param engine the engine
 * @param params configurations about this duel
 */
function createDuel(engine: OCGEngine<{}>, params: CreateDuelParams) {
  const duel = engine.createDuel(params.seed);

  params.players.forEach((player, index) => {
  params.players.forEach((player, playerId) => {
    const lp = player.lp || DEFAULT_LP;
    const draw = player.draw || DEFAULT_DRAW_COUNT;
    const start = player.start || DEFAULT_START_HAND;
    engine.setPlayerInfo(duel, { lp, draw, start, player: playerId });
    prepareCards(playerId, player.main, LOCATION.DECK);
    prepareCards(playerId, player.extra, LOCATION.EXTRA);
  });

  engine.startDuel(duel, params.options);

  const pump = () => parseMessage(engine.process(duel).data);
  return {
    queue: new MessageQueue(pump),
    engine,
    duel
  } as DuelState;

  function prepareCards(player: number, cards: number[], location: number) {
    for (const code of cards) {
      engine.newCard(duel, { player, owner: player, sequence: 0, code, location, position: POS.FACEDOWN });
    }
  }
}

function feed(state: DuelState, response: Buffer): boolean {
  state.engine.setResponse(state.duel, response);

  if (state.queue.peek().msgtype !== 'MSG_RETRY') {
    delete state.pendingQuestion;
    return true;
  }

  return false;
}

function step(state: DuelState): StepResult {
  if (state.finished) { return state.finished; }
  if (state.pendingQuestion) { return { tag: 'ASK_QUESTION', question: state.pendingQuestion } }

  const m = state.queue.get();

  if (m.msgtype === 'MSG_WIN') {
    state.finished = { tag: 'DUEL_FINISHED', why: { tag: 'REASON_WIN', message: m } };
  }

  if (isQuestionMessage(m)) { state.pendingQuestion = m; }

  const packets = state.pendingQuestion
    ? handleQuestion(state, m as Question)
    : handleMessage(state, m);

  return packets.length ? { tag: 'DISPATCH_PACKET', packets: packets, original: m } : step(state);
}

function refreshZone(state: DuelState, player: number, location: number, queryFlags: number, useCache: boolean) {
  const qbuff = state.engine.queryFieldCard(state.duel, { player, location, queryFlags, useCache });
  const header = [MSG.UPDATE_DATA, player, location];
  return parseMessage(Buffer.concat([Buffer.from(header), qbuff]))[0] as MsgUpdateData;
}

interface RefreshPack {
  location: number;
  queryFlags: number;
}

const REFRESH_FLAGS_DEFAULT = {
  HAND: 0x781FFF,
  MZONE: 0x881FFF,
  SZONE: 0x681FFF,
  SINGLE: 0xF81FFF
}

const M: RefreshPack = { location: LOCATION.MZONE, queryFlags: REFRESH_FLAGS_DEFAULT.MZONE };
const S: RefreshPack = { location: LOCATION.SZONE, queryFlags: REFRESH_FLAGS_DEFAULT.SZONE };
const H: RefreshPack = { location: LOCATION.HAND, queryFlags: REFRESH_FLAGS_DEFAULT.HAND };

function refreshMany(state: DuelState, player: number, where: RefreshPack[], useCache: boolean = true) {
  return where.map(({ location, queryFlags }) => refreshZone(state, player, location, queryFlags, useCache));
}

function hideCodeForUpdateData(m: MsgUpdateData): MsgUpdateData {
  const cards = m.cards.map(card => {
    if (!(card.query_flag & QUERY.CODE) || !card.info) return { ...card, code: 0 };
    if (!(card.info.position & POS.FACEUP)) return { ...card, code: 0 };
    return card;
  });

  return { ...m, cards };
}

function refreshCard(state: DuelState, player: number, location: number, sequence: number, flags: number, useCache: boolean) {
  const result = state.engine.queryCard(state.duel, { player, location, queryFlags: flags, useCache, sequence });
  const header = [MSG.UPDATE_CARD, player, location, sequence];
  return parseMessage(Buffer.concat([Buffer.from(header), result]))[0] as MsgUpdateCard;
}

function shouldResendRefreshSingle(m: MsgUpdateCard) {
  if (!('location' in m) || !('info' in m)) return false;
  if (m.location === LOCATION.REMOVED && (m.info!.position & POS.FACEDOWN)) return false;

  if (m.location & LOCATION.OVERLAY) return true;

  const positionAwareLoc = LOCATION.MZONE + LOCATION.SZONE + LOCATION.ONFIELD + LOCATION.REMOVED;
  return (m.location & positionAwareLoc) && (m.info!.position & POS.FACEUP);
}

const both = [0, 1]

function dispatch<M>(whom: number, what: M): Packet<M> { return { whom, what }; }
function another(player: number) { return 1 - player; }
function all(player: number) {
  return (u: MsgUpdateData) => [dispatch(player, u), dispatch(another(player), hideCodeForUpdateData(u))];
}

function handleQuestion(state: DuelState, /* NOTE: will modify */ m: Question): Packet<Message>[] {
  switch (m.msgtype) {
    case 'MSG_SELECT_BATTLECMD':
    case 'MSG_SELECT_IDLECMD':
      return both
        .map(player => refreshMany(state, player, [M, S, H]).map(all(player)))
        .reduce(flatten, [])
        .reduce(flatten, []);
    case 'MSG_SELECT_TRIBUTE':
    case 'MSG_SELECT_CARD':
      for (const card of m.selections) {
        if (card.controller !== m.player) {
          card.code = 0;
        }
      }
      break;
    case 'MSG_SELECT_UNSELECT_CARD':
      for (const card of m.not_selected) {
        if (card.controller !== m.player) {
          card.code = 0;
        }
      }
      for (const card of m.selected) {
        if (card.controller !== m.player) {
          card.code = 0;
        }
      }
      break;
    default:
      /* nothing to do */
  }
  return [];
}

function handleMessage(state: DuelState, m: Message) {
  const packets: Packet<Message>[] = [];
  _handleMessage(state, m, packets);
  return packets;

  function _handleMessage(state: DuelState, m: Message, out: Packet<Message>[]) {
    function tell(whom: number, what: Message) { out.push(dispatch(whom, what)); }
    function yell(what: Message) { tell(0, what); tell(1, what); }
    function secretlyTellMany(whom: number) {
      return (what: MsgUpdateData) => {
        tell(whom, what);
        tell(another(whom), hideCodeForUpdateData(what));
      }
    }
    function secretlyTell(whom: number, what: MsgUpdateCard) {
      tell(whom, what);
      if (shouldResendRefreshSingle(what)) tell(another(whom), what);
    }

    switch (m.msgtype) {
      case 'MSG_HINT':
        switch (m.type) {
          case 1: case 2: case 3: case 5: return tell(m.player, m);
          case 4: case 6: case 7: case 8: case 9: return tell(another(m.player), m);
          default: return yell(m);
        }

      case 'MSG_CONFIRM_CARDS':
        if (m.cards[0].location !== LOCATION.DECK) {
          return yell(m);
        } else {
          return tell(m.player, m);
        }

      case 'MSG_SHUFFLE_HAND':
      case 'MSG_SHUFFLE_EXTRA':
        tell(m.player, m);
        return tell(another(m.player), { ...m, cards: m.cards.map(() => 0) });

      case 'MSG_SHUFFLE_SET_CARD':
        for (const player of both) {
          tell(player, m);
          refreshMany(state, player, [{ location: m.location, queryFlags: 0x181FFF }], false).forEach(secretlyTellMany(player))
        }
        return;

      case 'MSG_NEW_PHASE':
      case 'MSG_NEW_TURN':
        for (const player of both) {
          refreshMany(state, player, [M, S, H]).forEach(secretlyTellMany(player));
          tell(player, m);
        }
        return;

      case 'MSG_MOVE':
        tell(m.current.controller, m);

        const graveOrOverlay = !!(m.current.location & (LOCATION.GRAVE + LOCATION.OVERLAY));
        const deckOrHand = !!(m.current.location & (LOCATION.DECK + LOCATION.HAND));
        const faceDown = !!(m.current.position & POS.FACEDOWN);

        if (!graveOrOverlay && (deckOrHand || faceDown)) {
          tell(another(m.current.controller), { ...m, code: m.code });
        } else {
          tell(another(m.current.controller), m);
        }

        if (m.current.location
          && !(m.current.location & LOCATION.OVERLAY)
          && (m.current.location !== m.previous.location || m.current.controller !== m.previous.controller)) {
          const q = refreshCard(state, m.current.controller, m.current.location, m.current.sequence, REFRESH_FLAGS_DEFAULT.SINGLE, false);
          secretlyTell(m.current.controller, q);
        }
        return;

      case 'MSG_POS_CHANGE':
        yell(m);
        if ((m.previous_position & POS.FACEDOWN) && (m.current_position & POS.FACEUP)) {
          const q = refreshCard(state, m.current_controller, m.current_location, m.current_sequence, REFRESH_FLAGS_DEFAULT.SINGLE, false);
          secretlyTell(m.current_controller, q);
        }
        return;

      case 'MSG_SET':
        return yell({ ...m, code: 0 });

      case 'MSG_SWAP':
        yell(m);
        for (const info of [m.first, m.second]) {
          const q = refreshCard(state, info.controller, info.location, info.sequence, REFRESH_FLAGS_DEFAULT.SINGLE, false);
          secretlyTell(info.controller, q);
        }
        return;

      case 'MSG_SUMMONED':
      case 'MSG_SPSUMMONED':
      case 'MSG_FLIPSUMMONED':
      case 'MSG_CHAINED':
      case 'MSG_CHAIN_SOLVED':
      case 'MSG_CHAIN_END':
        for (const player of both) {
          tell(player, m);
          const alsoRefreshHand = m.msgtype === 'MSG_CHAINED' || m.msgtype === 'MSG_CHAIN_SOLVED' || m.msgtype === 'MSG_CHAIN_END';
          refreshMany(state, player, alsoRefreshHand ? [M, S, H] : [M, S]).forEach(secretlyTellMany(player));
        }
        return;

      case 'MSG_CARD_SELECTED': return;

      case 'MSG_DRAW':
        tell(m.player, m);
        return tell(another(m.player), { ...m, cards: m.cards.map(code => {
          return (code & 0x80000000) ? code : 0;
        }) });

      case 'MSG_DAMAGE_STEP_START':
      case 'MSG_DAMAGE_STEP_END':
        for (const player of both) {
          tell(player, m);
          refreshMany(state, player, [M]).forEach(secretlyTellMany(player));
        }
        return;

      case 'MSG_MISSED_EFFECT':
        return tell(m.controller, m);

      default: return yell(m);
    }
  }
}

function flatten<T>(previous: T[], current: T[]) { return previous.concat(current); }
