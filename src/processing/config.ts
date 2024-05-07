

export const config = {
  valueSetMemberLimit: 200,
}


export const updateConfigFromOptions = (options: any) => {
  config.valueSetMemberLimit = options.valueSetLimit;
}