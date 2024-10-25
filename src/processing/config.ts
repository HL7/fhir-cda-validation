import { ImplementationGuide } from "fhir/r5";
import { logger } from "../utils/logger";
import { isOID } from "../utils/helpers";


export const config = {
  igPackage: '',
  commonTemplateIdRoot: 'xyz',
  valueSetMemberLimit: 0,
}


export const updateConfigFromOptions = (options: any, igPackage: string) => {
  config.valueSetMemberLimit = options.valueSetLimit;
  config.commonTemplateIdRoot = options.templateId;
  config.igPackage = igPackage;
}

export const updateConfigFromIG = (ig: ImplementationGuide) => {
  config.igPackage = `${ig.packageId}#${ig.version}`;
  const params = (ig.definition?.parameter || []); 
  // IG publisher is re-setting the system to its own - lol!
  //.filter(p => p.code.system === 'http://hl7.org/cda/stds/core/CodeSystem/IGParametersCDAValidation');
  for (const param of params) {
    switch (param.code.code) {
      case 'value-set-limit':
        const limit = parseInt(param.value);
        if (!isNaN(limit)) {
          config.valueSetMemberLimit = limit;
          logger.info(`IG ${ig.packageId} parameter: value-set-limit = ${limit}`);
        } else {
          logger.warn(`IG ${ig.packageId} has an invalid value-set-limit parameter: ${param.value}`);
        }
        break;
      case 'parent-template-id':
        const oid = param.value;
        if (isOID(oid)) {
          config.commonTemplateIdRoot = oid;
          logger.info(`IG ${ig.packageId} parameter: parent-template-id = ${oid}`);
        } else {
          logger.warn(`IG ${ig.packageId} has an invalid parent-template-id parameter: ${oid}`);
        }
        break;
    }
  }
}