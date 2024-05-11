declare module 'cda-schematron-validator' {

  function clearCache(): void;
  function validate(xml: string, schematron: string, options?: ValidationOptions): ValidationResult;

  interface ValidationOptions {
    includeWarnings?: boolean,
    resourceDir?: string,
    xmlSnippetMaxLength?: number,
  }

  interface ValidationKindResult {
    type: 'error' | 'warning',
    test: string,
    description: string,
    patternId?: string,
    ruleId?: string,
    assertionId?: string
    context?: string
  }

  interface ValidationResult {
    errors: ValidationKindResult[],
    warnings: ValidationKindResult[],
    ignored: (ValidationKindResult & { errorMessage?: string})[],
  }
  
}