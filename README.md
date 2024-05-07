# fhir-cda-validation
A standalone tool that can be used to convert any CDA implementation guide from FHIR Structure Definition into Schematron and other validation files.

For more information on the tool and how it converts SD to schematron, see the [FHIR-CDA-Validation Confluence Documentation](https://confluence.hl7.org/display/SD/FHIR-CDA-Validation).

> [!WARNING]
> This software is currently under-development and may change significantly. It is not intended to be used for production CDA validation.

# Installation
The converter is a [TypeScript](https://www.typescriptlang.org/) project. At a minimum, it requires [Node.js](https://nodejs.org/) to build, test, and run the CLI. Users should install Node.js 18. Although previous versions of Node.js may work, they are not officially supported.

## From npm
// Coming soon ... npm!

## From source

Execute the following commands:

```sh
git clone https://github.com/HL7/fhir-cda-validation.git # clone this repository
cd fhir-cda-validation                                   # navigate into the folder
npm install                                              # install dependencies
```

# Running the converter

Run the following to see the help and possible options:

```sh
npm start -- --help
```

Something like the following will display (note - the following is an example; run the latest version with `--help` to see all available options:

```
[INFO] 17:07:44 ts-node-dev ver. 2.0.0 (using ts-node ver. 10.9.2, typescript ver. 5.3.3)
Usage: fhir-cda <ig> [options]

FHIR/CDA Schematron Generator

Arguments:
  ig                                implementation guide to process

Options:
  -d, --dependency <dependency...>  additional dependencies to be loaded using format dependencyId@version
  -t, --terminology-server <url>    terminology server to use for expanding value sets (set to x to disable) (default: "https://tx.fhir.org/r5/")
  --value-set-limit <number>        maximum number of values to include in value set lookups (default: 200)
  -p --profile <string>             Process only a single profile (useful for testing)
  -h, --help                        display help for command
```

By default, the converter will load and convert the current build of C-CDA R3.0, but you can convert other CDA IG's by specifying the IG in the startup parameter.

## Output
While the converter runs, progress will be displayed on the console. Additionally, an `/output` folder will be created with the following artifacts generated:

- `[IG]-SD.sch` - The generated Schematron file
- `Bindings.json` - A report of all value set bindings along with XPath for their location
- `Results.json` (coming soon) - Summarization of conversion results

## Validating the Validator
The converter has its own internal test suite to verify conversion functions, but the generated `.sch` file should be examined for validity and appropriateness, as well. It should be run against known CDA samples to ensure it properly identifies errors and does not throw false-positives for valid examples. 

> [!NOTE]
> Automated validation of CDA samples using converted schematron is a planned, but not yet implemented, feature of this tool. 

## Known Limitations
- Only IG's created in FHIR R5 are supported
- Value sets containing values with apostrophes (`'`) are not included
- `conformsTo()` (and other FHIRPath functions not used by C-CDA) are not supported