

export const config = {
  valueSetMemberLimit: 500,
}


export const updateConfigFromOptions = (options: any) => {
  config.valueSetMemberLimit = options.valueSetLimit;
}