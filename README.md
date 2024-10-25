# fhir-cda-validation
A standalone tool that can be used to convert any CDA implementation guide from FHIR Structure Definition into Schematron and other validation files.

For more information on the tool and how it converts SD to schematron, see the [FHIR-CDA-Validation Confluence Documentation](https://confluence.hl7.org/display/SD/FHIR-CDA-Validation).

# Installation
The converter is a [TypeScript](https://www.typescriptlang.org/) project. At a minimum, it requires [Node.js](https://nodejs.org/) to build, test, and run the CLI. Users should install Node.js 18. Although previous versions of Node.js may work, they are not officially supported.

## From npm
Once Node.js is installed, run the following command to install or update the converter:

```sh
npm install -g @hl7/fhir-cda-validation
```

## From source

Execute the following commands:

```sh
git clone https://github.com/HL7/fhir-cda-validation.git # clone this repository
cd fhir-cda-validation                                   # navigate into the folder
npm install                                              # install dependencies
```

When running from source, start the converter and pass parameters using:

```sh
npm start -- --help
```

# Running the converter

Run the following to see the help and possible options:

```sh
fhir-cda --help
```

Something like the following will display (note - the following is an example; run the latest version with `--help` to see all available options:

```
[INFO] 17:07:44 ts-node-dev ver. 2.0.0 (using ts-node ver. 10.9.2, typescript ver. 5.3.3)
Usage: fhir-cda <ig> [options]

FHIR/CDA Schematron Generator

Arguments:
  ig                                implementation guide to process (pass . to generate schematron for IG in the current directory)

Options:
  -d, --dependency <dependency...>  additional dependencies to be loaded using format dependencyId@version
  -t, --terminology-server <url>    terminology server to use for expanding value sets (set to x to disable) (default: "https://tx.fhir.org/r5/")
  -l, --value-set-limit <number>    maximum number of values to include in value set lookups (default: 500)
  -tId --template-id <oid>          templateId root for unrecognized templateId warning
  -p --profile <string>             process only a single profile (useful for testing)
  -h, --help                        display help for command
```

By default, the converter will load and convert the current build of C-CDA R3.0, but you can convert other CDA IG's by specifying the IG in the startup parameter. Some of the other parameters:

- `tId`: A warning will be created for any templateId encountered not found in the IG. To prevent false positives, this is limited to templateIds corresponding to the target IG only, which can often be identified via a substring of all templateIds. For example, C-CDA defaults to `2.16.840.1.113883.10.20.22`. Any templateIds which start with that substring but which are not found in the IG will be logged as a warning.

## Output
While the converter runs, progress will be displayed on the console. Additionally, an `/output` folder will be created with the following artifacts generated:

- `[IG].sch`: The generated Schematron file (where [IG] is the name of the IG, like `CCDA`)
- `[IG]-Bindings.json`: A report of all value set bindings along with XPath for their location
- `[IG]-Results.json`: Summarization of conversion results
- `ValueSet-expansions.json`: Cached response to TX server's $expand calls - saves network calls between runs

### [IG]-Results.json Output File
This file summarizes the conversion results. Here are detailed explanations for each field:

- **errors**: Severe errors encountered during conversion. These typically indicate an issue within the converter itself. Please log a bug in GitHub if you encounter these.
- **notices**: Alerts that may indicate issues with the implementation guide (e.g., incorrectly formatted ValueSet URLs).
- **skippedTemplates**: Profiles/templates not included in the Schematron. CDA Schematron uses templateId to identify fragments to validate. All profiles need to either contain a templateId field & identifier or be used by other templates that include them.
- **unhandledInvariants**: Invariants that the conversion could not handle. Rewriting the FHIRPath or enhancing the conversion tool may be necessary.
- **nonLoadedValueSets**: Value Sets that could not be loaded, categorized by a code returned by either the terminology service or the converter.

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
- Only IG's created in FHIR R5 are currently supported
- Value sets containing values with apostrophes (`'`) are not included
- Comparisons on dateTimes are not supported (e.g. procedure start date must be before document date)
- Some assertions use the XPath 2.0 function `current()` which is not supported by the included validator. These assertions have been tested manually.
- `conformsTo()` (and other FHIRPath functions not used by C-CDA) are not supported