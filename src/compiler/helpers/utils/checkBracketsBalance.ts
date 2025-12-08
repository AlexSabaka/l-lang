const brackets: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const openBrackets = Object.keys(brackets);
const closeBrackets = Object.values(brackets);

/**
 * Checks if the brackets in the code are balanced.
 * @param code The code to check.
 * @returns true if the brackets are balanced, otherwise the number of unclosed brackets.
 */
export function checkBracketsBalance(code: string): true | number {
  const stack = [];
  let inString = false;
  for (const char of code) {
    if (char === '"') {
      inString = !inString;
    }

    if (inString) {
      continue;
    }

    if (openBrackets.includes(char)) {
      stack.push(brackets[char]);
    }

    if (closeBrackets.includes(char)) {
      if (stack.length === 0) {
        // -1 for unbalanced brackets (more closing than opening)
        return -1;
      }
      if (stack.pop() !== char) {
        // Return the number of unclosed brackets
        return stack.length;
      }
    }
  }

  // Return true if the stack is empty,
  // otherwise return the number of unclosed brackets
  return !stack.length ? true : stack.length;
}
