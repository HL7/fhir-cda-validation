

export const config = {
  commonTemplateIdRoot: 'xyz',
  valueSetMemberLimit: 0,
}


export const updateConfigFromOptions = (options: any) => {
  config.valueSetMemberLimit = options.valueSetLimit;
  config.commonTemplateIdRoot = options.templateId;
}