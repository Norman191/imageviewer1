// Scripted playback: schedules project.script.events (sorted by `time`,
// seconds from script start) and fires them into the REAL chat by calling
// the same actions the manual composer uses (ctx.actions.sendMessage,
// toggleReaction, etc.) — so playback never needs its own chat renderer,
// and manual sending keeps working exactly as before, untouched.
export function createPlayback(ctx) {
  let timers = [];
  let playing = false;
  // Maps a script event id (for 'message' events) to the real message id
  // it produced, so a later 'reaction' event can target it. Cleared on stop.
  let eventIdToMessageId = {};

  function clearTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  function runEvent(event) {
    const state = ctx.getState();
    switch (event.action) {
      case 'message':
      case 'file': {
        const beforeIds = new Set(state.messages.map((m) => m.id));
        ctx.actions.playbackSendMessage(event.characterId, event.payload.text || '', event.payload.attachments);
        // Find the newly created message so a later reaction event can target it.
        const after = ctx.getState().messages;
        const created = after.find((m) => !beforeIds.has(m.id));
        if (created) eventIdToMessageId[event.id] = created.id;
        ctx.actions.setTypingCharacter(null);
        break;
      }
      case 'typing':
        ctx.actions.setTypingCharacter(event.characterId);
        break;
      case 'reaction': {
        const targetMessageId = eventIdToMessageId[event.payload.targetEventId];
        if (targetMessageId && event.characterId) {
          ctx.actions.toggleReaction(targetMessageId, event.payload.emoji, event.characterId);
        }
        if (targetMessageId && event.payload.automation) {
          ctx.actions.startReactionAutomation(targetMessageId, event.payload.emoji, event.payload.automation);
        }
        break;
      }
      case 'wait':
      default:
        break; // no-op: the event's own `time` already advances the schedule
    }
  }

  function play() {
    if (playing) return;
    const state = ctx.getState();
    const events = (state.script && Array.isArray(state.script.events) ? state.script.events : [])
      .slice()
      .sort((a, b) => a.time - b.time);
    if (!events.length) return;

    playing = true;
    events.forEach((event) => {
      const timer = setTimeout(() => {
        runEvent(event);
        if (event === events[events.length - 1]) {
          playing = false;
        }
      }, Math.max(0, event.time * 1000));
      timers.push(timer);
    });
  }

  function pause() {
    // "Pause" cancels remaining scheduled events; already-fired events
    // (and the messages they produced) stay in the chat. Resuming from a
    // mid-point isn't tracked — Play always restarts the full script, which
    // keeps the engine simple and matches "Stop/reset" being the explicit
    // way to clear state.
    clearTimers();
    playing = false;
    ctx.actions.setTypingCharacter(null);
  }

  function stop() {
    clearTimers();
    playing = false;
    eventIdToMessageId = {};
    ctx.actions.setTypingCharacter(null);
  }

  return {
    play,
    pause,
    stop,
    isPlaying: () => playing
  };
}
