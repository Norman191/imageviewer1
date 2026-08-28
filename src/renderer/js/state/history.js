// Simple command-pattern undo/redo stack.
// Each command is { label, do(), undo() }. `do` is expected to perform the
// state mutation AND any necessary UI patch; `undo` reverses both.

const MAX_HISTORY = 500;

export class History {
  constructor(onChange) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange || (() => {});
  }

  execute(command) {
    command.do();
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(command.scope || 'all');
  }

  undo() {
    if (!this.undoStack.length) return false;
    const command = this.undoStack.pop();
    command.undo();
    this.redoStack.push(command);
    this.onChange(command.scope || 'all');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const command = this.redoStack.pop();
    command.do();
    this.undoStack.push(command);
    this.onChange(command.scope || 'all');
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }
}
