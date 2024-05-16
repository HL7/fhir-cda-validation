import { Assert } from "../model/assert"
import { StructureDefinition } from "./structureDefinition";
import { logger } from "../utils/logger";
import { getErrorMessage, pipe } from "../utils/helpers";
import { cdaTypeToFilter, ofType, sdFromCdaType, templateIdContextFromProfile, typeFilter, xmlNameFromDefs } from "../utils/cdaUtil";
import { UnsupportedInvariantError } from "../utils/errors";
import { voc } from "./terminology";

interface InvariantResponse {
  Unsupported?: string,
  Processed?: {
    Assertion: Assert,
    Strength: fhir5.ElementDefinitionConstraint['severity']
  }
}

// Process a single invariant into a Schematron assertion (or log the reason why it cannot be processed)
export const processInvariant = async (inv: fhir5.ElementDefinitionConstraint, sd: StructureDefinition, context: string): Promise<InvariantResponse>  => {
  // No expression - nothing to test!
  if (!inv.expression) return {};

  // Handle ValueSet lookup first - see if we can avoid promisifying convertExpression
  const vsMatch = inv.expression.matchAll(/memberOf\('([^']+)'\)/g);
  if (vsMatch) {
    try {
      await Promise.all([...vsMatch].map(async (m) => voc.loadValueSet(m[1])));
    }
    catch (e) {
      logger.error(`Error in invariant ${inv.key} from ${sd.name}: ${getErrorMessage(e)}`);
    }
  }

  try {
    const converted = convertExpression(inv.expression, sd, context);
    // logger.info(inv.key + ' - ' + converted + "\n" + inv.expression + "\n");
    return converted ? {
      Processed: {
        Strength: inv.severity,
        Assertion: new Assert(converted, inv.human, inv.key),
      }
    } : {};
  } catch (e) {
    if (e instanceof UnsupportedInvariantError) {
      return {
        Unsupported: e.message
      };
    }
    logger.debug(`${inv.key}: ${inv.expression}`);
    logger.error(`Error in invariant ${inv.key} from ${sd.name}: ${getErrorMessage(e)}`);
    return {};
  }
}

// Main entry point to convert the expression, has a 
export const convertExpression = (originalExpression: string, originalSd: StructureDefinition, originalContext: string): string => {
  let tokenCounter = 0;
  let stringTokens: Record<string, string> = {};

  let sd = originalSd;
  let context = originalContext;


  // Recursive portion of expression conversion - this is called a lot!
  const convertSubExpression = (expression: string, subContext?: string): string => {
    if (!expression) return '';
    expression = expression.trim().replace(/^\.|\.$/g, '');
    if (expression.length === 0) return '';

    const tempTokensOriginal: Record<string, string> = {};
    const tempTokens: Record<string, string> = {};
    const resetTokens = (expression: string) => {
      for (const [token, value] of Object.entries(tempTokens)) {
        expression = expression.replace(token, value);
      }
      return expression;
    }

    // .exists() and .toString() can just be removed
    expression = expression.replaceAll('.exists()', '').replaceAll('.toString()', '');

    // Tokenize Strings
    expression = expression.replace(/('(?:\\'|[^'])*')/g, (_, match) => {
      const token = `ttStr${tokenCounter++}`;
      tempTokens[token] = match.replace(/\\'/g, "'");
      stringTokens[token] = tempTokens[token];
      return token;
    });

    if (expression.match(/%(?!resource|context)/)) {
      throw new Error('Variables are not supported yet');
    }
    if (expression.includes('@')) {
      throw new Error('DateTime literals are not supported yet');
    }

    // Tokenize all parentheticals!
    let parenPos = expression.indexOf('(');
    while (parenPos >= 0) {

      // No need to do anything for ()
      if (expression[parenPos + 1] === ')') {
        parenPos = expression.indexOf('(', parenPos + 2);
        continue;
      }
            
      const parenthetical = extractParenthetical(expression, parenPos);

      // Some things don't need replacements
      if (parenthetical.match(/^tt\w+$/) || parenthetical.match(/^CDA\.(\w|-)+$/)) {
        parenPos = expression.indexOf('(', parenPos + 2 + parenthetical.length);
        continue;
      }

      // If parenthetical is part of where(*) or exists(*), we need the context before the function in order to look up XML names
      let newSubContext: string | undefined;

      // Matches 
      // ^:    field.where()  - [1] = field
      // ).    (parenth).field.where() - [1] = field
      const contextMatch = expression.slice(0, parenPos + 1).match(/(?:^|\s|\)\.)(%?\w+(?:\.\w+)*)\.(?:exists|where)\($/i)
        || expression.slice(0, parenPos + 1).match(/(?:^|\s)\((\w+)\)\.(?:exists|where)\($/i);
      // TODO - need to grab context from nested where's (just getting lucky on PolicyActivity)
      if (contextMatch) {
        newSubContext = contextMatch[1];
        if (newSubContext.startsWith('tt') && tempTokensOriginal[newSubContext]) {
          newSubContext = unwrapParens(tempTokensOriginal[newSubContext]);
        }
      }

      const newTypeContextMatch = expression.slice(0, parenPos + 1).match(/\.ofType\(([^)]+)\)\.where\($/i);
      
      const token = 'tt' + tokenCounter++;

      const keepParens = true;  (parenPos > 0 && expression[parenPos - 1].match(/[a-z]/));

      expression = expression.replace(keepParens ? parenthetical : `(${parenthetical})`, token);
      tempTokensOriginal[token] = parenthetical;

      if (newTypeContextMatch) {
        // Need to fully restart the expression from the new root, based on ofType()
        sd = sdFromCdaType(newTypeContextMatch[1]);
        context = sd.root()!;
        tempTokens[token] = resetTokens(convertSubExpression(parenthetical));
        sd = originalSd;
        context = originalContext;
      } else {
        tempTokens[token] = resetTokens(`${convertSubExpression(parenthetical, newSubContext)}`);
      }
      parenPos = expression.indexOf('(', parenPos + 2 + token.length);
    }

    // Implies - has a space so deal with first
    const implies = expression.match(/^(.+)\s+implies\s+(.+)$/);
    if (implies) {
      return resetTokens(`not(${convertSubExpression(implies[1], subContext)}) or ${convertSubExpression(implies[2], subContext)}`);
    }

    // Boolean Operators
    const andOr = expression.match(/^(.*)\s+(and|or|xor)\s+(.*)$/);
    if (andOr) {
      // Untested
      if (andOr[2] === 'xor') {
        const a = convertSubExpression(andOr[1], subContext);
        const b = convertSubExpression(andOr[3], subContext);
        return resetTokens(`${a} and not(${b}) or ${b} and not(${a})`);
      }
      return resetTokens(`${convertSubExpression(andOr[1], subContext)} ${andOr[2]} ${convertSubExpression(andOr[3], subContext)}`);
    }

    // Equivalence operator (roughly supported as (not A and not B) or A = B  )
    for (const symbol of ['!~', '~']) {
      if (expression.includes(symbol)) {
        const parts = expression.split(symbol);
        if (parts.length !== 2) {
          throw new Error(`More than two operands found for comparator ${symbol}`);
        }
        const left = convertSubExpression(parts[0], subContext);
        const right = convertSubExpression(parts[1], subContext);

        if (symbol === '~') {
          return resetTokens(`(not(${left}) and not(${right})) or ${left} = ${right}`);
        }
        // Not supporting !~ for now...
        throw new UnsupportedInvariantError(`${symbol} operator not supported yet`);
      }
    }

    // Comparisons
    for (const symbol of ['<=', '>=', '!=', '<', '>', '=']) {
      if (expression.includes(symbol)) {
        const parts = expression.split(symbol);
        if (parts.length !== 2) {
          throw new Error(`More than two operands found for comparator ${symbol}`);
        }
        return resetTokens(`${convertSubExpression(parts[0], subContext)} ${symbol} ${convertSubExpression(parts[1], subContext)}`);
      }
    }

    // Unions
    if (expression.includes('|')) {
      return '(' + resetTokens(expression.split('|').map(ex => convertSubExpression(ex, subContext)).join(' | ')) + ')';
    }

    // In / Contains (todo)
    if (expression.includes(' in ')) {
      const parts = expression.split(' in ');
      if (parts.length !== 2) {
        throw new Error(`More than two operands found for operator 'in' (${expression})`);
      }
      // contains(x, y) means that y is contained within the list x .... silly XPath
      return resetTokens(`contains(${convertSubExpression(parts[1], subContext)}, ${convertSubExpression(parts[0], subContext)})`);
    }

    // Whitespace check (should be taken care of by now; anything that remains probably means we missed a FHIRPath feature)
    if (expression.includes(' ')) {
      throw new Error(`Unexpected space in expression ${expression}`);
    }

    // If we start with context... the rest needs to be re-set to the original type
    if (expression.startsWith('%context')) {
      // Not passing any subContext to convertSubExpression because %context resets us!
      // .... AHA. Well, I guess if expression _ever_ starts with %context, we need to reset... at least before functions... maybe?
      return expression === '%context' ? 'current()' : `current()/${convertExpression(expression.slice(9), originalSd, originalContext)}`
      //return expression === '%context' ? 'current()' : `current()/${convertSubExpression(expression.slice(9))}`;
    }

    // Special handling for descendants
    const descFun = expression.match(/^(.*)descendants\(\)(?:\.ofType\(([^)]+)\))?(.*)$/);
    if (descFun) {
      const pre = descFun[1] === '%resource.' ? '/cda:ClinicalDocument' : convertSubExpression(descFun[1] || '', subContext);
      const elements = descFun[2] ? ofType(descFun[2]) : '*';
      let post = '';
      if (descFun[3]) {
        if (descFun[2]) {
          // Reset context when we have an ofType
          const oldSd = sd;
          const oldContext = context;
          sd = sdFromCdaType(descFun[2]);
          context = sd.root()!;
          post = resetTokens(convertSubExpression(descFun[3]));
          sd = oldSd;
          context = oldContext;
        } else {
          post = resetTokens(convertSubExpression(descFun[3]));
        }
      }
      return `${pre}//${elements}${post}`;
    }

    // Straight function comparisons
    const replFun = expression.match(/^(.*\s+)?(\S+)\.(count|length|empty|not|first)\(\)\.?(.*)$/);
    if (replFun) {
      // If there's something before the function
      const noParams = {
        first: '[1]'
      }[replFun[3]];
      const parameterized = {
        count: 'count',
        length: 'string-length',
        empty: 'not',
        not: 'not'   // This is ONLY (so far) in MedicationActivity and its slice isn't supported yet
      }[replFun[3]];

      tempTokens['ttFun'] = noParams ? resetTokens(`${convertSubExpression(replFun[2], subContext)}${noParams}`)
        : resetTokens(`${parameterized}(${convertSubExpression(replFun[2], subContext)})`);
      // return resetTokens(convertSubExpression(`${replFun[1] || ''}ttFun${replFun[4] || ''}`, subContext));
      // If there's more, then we need to build a new subContext (there are no spaces, so it continues from the context before the function)
      const newSubContext = [replFun[2], subContext].filter(Boolean).join('');
      const postFun = replFun[4] ? `/${convertSubExpression(replFun[4], newSubContext)}` : '';
      return resetTokens(`${convertSubExpression(replFun[1] || '', subContext)}ttFun${postFun}`);
    }

    // Straight function comparisons - where the function 

    // More involved functions
    const complexFun = expression.match(/^(.*)(hasTemplateIdOf|ofType|startsWith|memberOf|matches)\(([^)]+)\)(.*)$/);
    if (complexFun) {
      let profile = complexFun[3];
      if (profile.match(/^tt[^S]/)) profile = tempTokens[profile]; // This might be a hack; only solves one level of tokenization since sting tokenization; try it anyway
      // Strings have been tokenized; get actual profile name and remove quotes
      if (profile.startsWith('ttStr')) profile = stringTokens[profile].slice(1, -1); //  = tempTokens[profile].slice(1, -1);
      tempTokens['ttCmplxFun'] = functionReplacements[complexFun[2]](profile);

      // TODO - moving this to parenthetical-handling
      // let postExpression = convertSubExpression(complexFun[4], subContext);
      // // If .ofType is followed by .where, then we have an entirely new root to start from
      // if (complexFun[2] === 'ofType' && complexFun[4].startsWith('.where')) {
      //   const newSd = sdFromCdaType(profile);
      //   postExpression = convertExpression(complexFun[4], newSd, newSd.root()!);
      // }

      return resetTokens(`${convertSubExpression(complexFun[1], subContext)}ttCmplxFun${convertSubExpression(complexFun[4], subContext)}`);
    }


    // Where
    const where = expression.match(/^(.*\s+)?(\S*)(where|exists)\(([^)]+)\)(.*)$/);
    if (where) {
      tempTokens['ttWhere'] = resetTokens(`${convertSubExpression(where[2], subContext)}[${where[4]}]`);

      // We have a chained where - need to convert pre/post sub-expressions individually and pass context from the part before .where into the part after
      if (where[5]?.startsWith('.')) {
        const beforeWhere = convertSubExpression(where[1], subContext);
        const afterWhere = convertSubExpression(where[5].slice(1), [subContext, where[2]].filter(Boolean).join('.'));
        return resetTokens(`${beforeWhere}ttWhere/${afterWhere}`);
      }
      // Otherwise, can just convert the whole expression
      return resetTokens(convertSubExpression(`${where[1] || ''}ttWhere${where[5] || ''}`));
    }

    // Unwrap parentheses
    let hadParens = false
    while (expression.match(/^\((.+)\)$/)) {
      expression = expression.slice(1, -1);
      hadParens = true;
    }

    const unsupFun = expression.match(/(\w+)\(/);
    if (unsupFun) {
      throw new UnsupportedInvariantError(`Unsupported function ${unsupFun[1] || expression}`);
    }

    if (expression.startsWith('%resource') && !subContext) {
      return `/cda:ClinicalDocument/` + convertSubExpression(expression.slice(10), '%resource.');
    }

    // At this point we SHOULD just have literals or paths
    // (moved space check higher)
    // if (expression.includes(' ')) {
    //   throw new Error(`Unexpected space in expression ${expression}`);
    // }

    // A single token can just be returned; it has already been converted (or will be replaced in a higher stack)
    if (expression.startsWith('tt')) {
      if (expression.includes('.')) {
        throw new Error(`Unexpected . in tokenized expression ${expression}`);
      }
      return hadParens ? `(${resetTokens(expression)})` : resetTokens(expression);
    }

    if (expression.match(/^true|false|-?\d+(\.\d+)?$/)) {
      return expression;
    }

    if (expression === '$this') {
      return 'self::node()';
    } else if (expression.startsWith('$this.')) {
      return 'self::node()/' + convertSubExpression(expression.slice(6), subContext);
    }

    let xpath;
    // TODO - this is a mess - if there's a subcontext, this might throw an error, but we want to ignore it
    try {
      xpath = sd.pathToXpath(context, unwrapParens(expression)) || xmlNameFromDefs(sd.elementDefAtId(context)!, expression);
    } catch (e) {
      if (!subContext) throw e;
    }
    
    if (!xpath && subContext) {
      // if subContext is actually a union; get the xpath from each union. It had better be the same!
      for (const unionContext of subContext.split('|').map(x => x.trim())) {

        // TODO - if unionContext starts with CDA. - then we need to reset the SD to a CDA datatype and start afresh
        // Actually TODO - can probably replace this if doing during parens
        let unionXPath;
        if (unionContext.startsWith('CDA.')) {
          const newSd = sdFromCdaType(unionContext.slice(4));
          unionXPath = newSd.pathToXpath(sd.root()!, expression);
        } else {
          unionXPath = xmlNameFromDefs(sd.elementDefAtId(context)!, expression, unionContext);
        }

        // const unionXPath = xmlNameFromDefs(sd.elementDefAtId(context)!, expression, unionContext);
        if (unionXPath && xpath && unionXPath !== xpath) {
          throw new Error(`Unable to find unique xpath for ${expression} at ${context} while checking ${subContext}. Found ${xpath} and ${unionXPath}`);
        }
        if (unionXPath) xpath = unionXPath;
      }
      
    }
    if (!xpath) {
      throw new Error(`Unable to find definition for ${expression} at ${context} (subpath is ${subContext})`);
    }
    return hadParens ? `(${xpath})` : xpath;
  }

  const functionReplacements: Record<string, (parameter: string) => string> = {
    hasTemplateIdOf: (profile: string) => {
      const templateIdWhere = templateIdContextFromProfile(profile);
      if (!templateIdWhere) {
        throw new Error(`Error in hasTemplateIdOf: could not find templateId for profile ${profile}`);
      }
      return `[${templateIdWhere}]`;
    },
    ofType: (type: string) => {
      if (!type.startsWith('CDA')) {
        throw new Error(`ofType() requires a CDA.type in CDA IGs.`);
      }
      return `[${cdaTypeToFilter(type.slice(4))}]`;
    },
    startsWith: (starting: string) => {
      return `[starts-with(., '${starting}')]`;
    },
    memberOf: (valueSet: string) => {
      const vsName = voc.getSavedValueSetName(valueSet);
      if (!vsName) {
        throw new UnsupportedInvariantError(`Cannot calculate memberOf, Value Set ${valueSet} is not loaded.`);
      }
      return `[contains($${vsName}, .)]`
    },
    matches: (pattern: string) => {
      // TOOD - support more patterns via config?
      const replacement = {
        '[0-9]{5}(-[0-9]{4})?': "[(string-length(normalize-space()) = 5 and translate(., '0123456789', '0000000000') = '00000') or (string-length(normalize-space()) = 10 and translate(., '0123456789', '0000000000') = '00000-0000')]"
      }[pattern];
      if (!replacement) {
        throw new Error(`Unsupported matches pattern: ${pattern}`);
      }
      return replacement;
    }
  }

  // Run the conversion, then run some post-processing functions to clean up weird leftovers
  const convertedExpression = convertSubExpression(originalExpression);

  if (convertedExpression.includes('effectiveTime') && (convertedExpression.includes('<') || convertedExpression.includes('>'))) {
    throw new UnsupportedInvariantError('Comparisons on datetime elements are not supported');
  }

  return pipe(...[
    removeDoubleBrackets,
    deunionizeContains,
    adjustLengths,
  ])(convertedExpression);
}



function extractParenthetical(input: string, startingFrom = 0): string {
  let result = '';
  let depth = 0;

  for (let i = startingFrom; i < input.length; i++) {
    const char = input[i];
    if (char === '(') {
      if (depth > 0) result += char;
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth > 0) result += char;
      else return result;
    } else if (depth > 0) {
      result += char;
    }
  }

  throw new Error('mismatched parentheses in expression: ' + input);
}

/**
 * If a string starts and ends with parentheses, remove them
 * @param input 
 * @returns 
 */
export const unwrapParens = (input: string): string => input.startsWith('(') && input.endsWith(')') ? unwrapParens(input.slice(1, -1)) : input;

/**
 * Remove double-brackets from an expression.
 * (Lazy fix for weird cases that are doing things like cda:observation[[templateId.... and other stuff]])
 * Removes the extra [[ ]] but only if opening and closing are both double-brackets.
 * @param input
 * @returns 
 */
export const removeDoubleBrackets = (input: string): string => {
  let start = input.indexOf('[[');
  if (start < 0) return input;
  let depth = 2;
  
  for (let i = start+2; i < input.length; i++) {
    const char = input[i];
    if (char === '[') {
      depth++;
    }
    if (char === ']') {
      depth--;
      if (depth === 1 && i < input.length-1 && input[i+1] === ']') {
        return removeDoubleBrackets(input.slice(0, start) + input.slice(start + 1, i) + input.slice(i + 1));
      }
      if (depth === 0) {
        throw new Error(`mismatched [[ in expression ${input} (opening double-bracket should have an equivalent closing double-bracket)`);
      }
    }
  }
  throw new Error(`mismatched [[ in expression ${input}`);
}

/**
 * Converts something like:
 * 
 * not((contains((('8287-5' | '8302-2' | '8306-3' | '9843-4')), cda:code/@code))) or cda:value/@unit = 'cm'
 * into
 * not((contains((('8287-5 8302-2 8306-3 9843-4')), cda:code/@code))) or cda:value/@unit = 'cm'
 * 
 * (at least until we find a better way to disambiguate unions from code lists)
 * @returns 
 */
export const deunionizeContains = (input: string): string => {
  // 1st group: contains(((
  // 2nd group: 'value' | 'value' | 'value'
  // followed by )
  return input.replace(/(contains\(+)(\'[^' |)]+\'(?:\s+\|\s+\'[^' |)]+\')+)\)/, (match, start, list) => `${start}${list.replace(/\'\s+\|\s+\'/g, ' ')})`);
}

/**
 * Make adjustments for FHIR vs CDA time lengths
 * Note - this just assumes @value and string-length is only used for time elements
 * It also only seems that we use "10" in C-CDA, so that's all I adjust, but if 
 * some invariant were written like "precise to at least the month", then we'd have 
 * look for 7 (YYYY-MM) and convert that to 6 (YYYYMM). Handling 10 by itself is just easier.
 * 
 * @param input 
 * @returns 
 */
export const adjustLengths = (input: string): string => {
  return input.replace(/(string-length\(@value\) (?:&gt;|>)?=?) 10/, '$1 8');
}