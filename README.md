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

- `[IG].sch` - The generated Schematron file (where [IG] is the name of the IG, like `CCDA`)
- `[IG]-Bindings.json` - A report of all value set bindings along with XPath for their location
- `ValueSet-expansions.json` - Cached response to TX server's $expand calls - saves network calls between runs
- `[IG]-Results.json` (coming soon) - Summarization of conversion results

## Validating the Generated Schematron
The converter has its own internal test suite to verify conversion functions, but the generated `.sch` file should be examined for validity and appropriateness, as well. It should be run against known CDA samples to ensure it properly identifies errors and does not throw false-positives for valid examples.

There is an additional npm script available when running from source code which will run any files in the `/validation` directory against generated schematron files. This uses the open-source [cda-schematron-validator](https://github.com/priyaranjan-tokachichu/cda-schematron-validator) package which has _some_ limitations<sup>*</sup> but seems to be catching most of the generated schematron rules.

> `npm run validate   # runs the validation script and re-runs upon any changes in /validation or /output`

The subdirectory under `/validation` corresponds to the IG name of the generated schematron in the `/output` directory. Any XML files in a particular subdirectory will be validated against that schematron, if it exists in the output directory (i.e. `/validation/CCDA/*.xml` is validated against `/output/CCDA.sch`).

By default, all files are expected to be error-free (but not necessarily warning-free). If, however, the file contains known errors or warnings, include an XML comment (anywhere in the file) that starts with `e:` or `w:`, and this script will check whether the schematron produces the expected error or warning message. The string in the XML file after `e:` or `w:` may be a subset of the actual schematron-produced message, but everything after the `:` up to the end of the line must appear (with the exception of `-->`). For example, `CCDErrors.xml` contains the following expected errors:

```xml
<!-- e: SHALL contain exactly one [1..1] city 
     e: Cardinality of city is 0..1
     e: SHALL have at most one of each: state, city, postalCode, and country -->
```
which validates 3 different errors that fire when city occurs more than once, and later,
```xml
<!-- e: postalCode element is required -->
```
validates the postalCode formatting constraint (while not being nearly as long as the _actual_ description that is fired when that schematron rule triggers).

All expected `e:` and `w:` messages _must_ appear in the schematron validation results for the test to pass, and no additional (unexpected) errors may be thrown. Additional warnings may be produced but will not cause this script to fail.

<details>
<summary>*Issues with `cda-schematron-validator` and work-arounds</summary>

**Variable Resolution**
Schematron variables like `<let name="Ethnicity" value="'2135-2 2186-5'"/>` are not supported. While the package could be enhanced, until that occurs, the schematrons are pre-processed to remove all references to these variables. For example, any instance in the schematron of `$Ethnicity` is replaced with `'2135-2 2186-5'`.

</details>



## Known Limitations
- Only IG's created in FHIR R5 are supported
- Value sets containing values with apostrophes (`'`) are not included
- Comparisons on dateTimes are not supported (e.g. procedure start date must be before document date)
- `conformsTo()` (and other FHIRPath functions not used by C-CDA) are not supported