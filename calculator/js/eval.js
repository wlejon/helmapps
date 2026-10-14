/**
 * Re-exports the calculator expression evaluator and formatter from parser.js.
 */

export {
  tokenize,
  evaluate,
  parse,
  factorial,
  cleanNumber,
  formatResult,
  formatDisplayNumber,
} from './parser.js';
