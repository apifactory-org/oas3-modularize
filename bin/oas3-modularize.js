#!/usr/bin/env node

/**
 * oas3-modularize
 *
 * CLI para trabajar con contratos OpenAPI 3:
 * 1. Modularizar un archivo YAML único (paths + components).
 * 2. Validar la estructura modular con Redocly.
 * 3. Generar un bundle único con Redocly (dereferenced + remove-unused-components).
 * 4. Generar documentación en Markdown con Widdershins.
 *
 * Si ejecutas el comando SIN argumentos:
 *    oas3-modularize
 * se mostrará un MENÚ interactivo con opciones.
 */

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { exec } = require('child_process');
const { promisify } = require('util');
const inquirerModule = require('inquirer');
// Compatibilidad: inquirer v8 (CJS) y v9+ (ESM)
const inquirer = inquirerModule.default || inquirerModule;
const chalk = require('chalk');

const execPromise = promisify(exec);

// ---------------------------------------------------------------------------
// Configuración de rutas base
// ---------------------------------------------------------------------------

/**
 * Directorio base donde se generará la estructura modular.
 * Contendrá `openapi.yaml`, `components/` y `paths/`.
 */
const TARGET_DIR = 'src';

/** Directorio de componentes: src/components */
const COMPONENTS_DIR = path.join(TARGET_DIR, 'components');

/** Directorio de paths: src/paths */
const PATHS_DIR = path.join(TARGET_DIR, 'paths');

/**
 * Archivo principal OpenAPI modularizado (entrypoint para Redocly).
 */
const MAIN_FILE = path.join(TARGET_DIR, 'openapi.yaml');

/**
 * Directorio de salida para bundle final y documentación.
 */
const DIST_DIR = 'dist';

// ---------------------------------------------------------------------------
// Utilidades generales
// ---------------------------------------------------------------------------

/**
 * Devuelve la ruta absoluta al ejecutable ubicado en `node_modules/.bin`
 * del propio paquete `@apifactory/oas3-modularize`.
 *
 * Esto permite que el CLI use SIEMPRE sus propias dependencias (Redocly,
 * Widdershins), tanto si se instala localmente como globalmente.
 *
 * Estructura típica:
 *   .../node_modules/@apifactory/oas3-modularize/bin/oas3-modularize.js  (__dirname)
 *   .../node_modules/@apifactory/oas3-modularize/node_modules/.bin/*     (binarios)
 *
 * @param {string} baseName Nombre base del ejecutable (ej: 'redocly', 'widdershins').
 * @returns {string} Ruta absoluta al ejecutable correspondiente.
 */
function getBinPath(baseName) {
  // __dirname -> .../@apifactory/oas3-modularize/bin
  // subimos un nivel -> .../@apifactory/oas3-modularize
  const binDir = path.join(__dirname, '..', 'node_modules', '.bin');

  let executableName = baseName;
  if (process.platform === 'win32') {
    executableName = `${baseName}.cmd`;
  }

  return path.join(binDir, executableName);
}

/**
 * Escribe contenido como YAML en una ruta específica.
 *
 * @param {string} filePath - Ruta del archivo de salida.
 * @param {object} content - Objeto JavaScript que se serializará como YAML.
 */
function writeYamlFile(filePath, content) {
  const yamlContent = yaml.dump(content, { indent: 2, lineWidth: 80 });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yamlContent, 'utf8');
  console.log(chalk.green(`✔ Creado: ${filePath}`));
}

/**
 * Convierte una ruta OAS3 (ej. '/users/{id}') en un nombre de archivo
 * seguro (ej. 'users-id.yaml').
 *
 * @param {string} routePath - La ruta OAS3 (key en `paths`).
 * @returns {string} - Nombre de archivo YAML asociado a esa ruta.
 */
function slugifyPath(routePath) {
  // Reemplaza barras por guiones
  let slug = routePath.replace(/\//g, '-');
  // Elimina { } y guion inicial
  slug = slug.replace(/[{}]/g, '').replace(/^-/, '');
  // Para la ruta '/'
  if (slug === '') return 'root.yaml';
  return `${slug}.yaml`;
}

/**
 * Corrige los $ref dentro de un objeto OpenAPI, transformándolos a rutas relativas
 * correctas en función del tipo de contenido (schemas, requestBodies, paths, etc).
 *
 * Estrategia:
 * - `schemas`:
 *    "#/components/schemas/Foo" -> "#/Foo"
 * - otros componentes (requestBodies, responses, ...):
 *    "#/components/schemas/Foo"        -> "./schemas.yaml#/Foo"
 *    "#/components/requestBodies/Bar"  -> "./requestBodies.yaml#/Bar"
 * - `paths`:
 *    "#/components/schemas/Foo" -> "../openapi.yaml#/components/schemas/Foo"
 *
 * @param {object} content       Objeto con el contenido a corregir.
 * @param {string} componentType Tipo ("schemas", "requestBodies", "paths", etc.).
 * @returns {object}             Objeto con referencias corregidas.
 */
function fixRefs(content, componentType) {
  let contentString = JSON.stringify(content);

  if (componentType === 'schemas') {
    // "#/components/schemas/Category" -> "#/Category"
    contentString = contentString.replace(
      /"#\/components\/schemas\/([^"]+)"/g,
      (match, componentName) => `"#/${componentName}"`,
    );
  } else if (
    ['requestBodies', 'responses', 'securitySchemes', 'parameters', 'examples'].includes(
      componentType,
    )
  ) {
    // "#/components/schemas/Pet" -> "./schemas.yaml#/Pet"
    contentString = contentString.replace(
      /"#\/components\/schemas\/([^"]+)"/g,
      (match, componentName) => `"./schemas.yaml#/${componentName}"`,
    );

    // "#/components/requestBodies/Foo" -> "./requestBodies.yaml#/Foo"
    const re = new RegExp(`"#\\/components\\/${componentType}\\/([^"]+)"`, 'g');
    contentString = contentString.replace(re, (match, componentName) => {
      return `"./${componentType}.yaml#/${componentName}"`;
    });
  } else if (componentType === 'paths') {
    // "#/components/schemas/Foo" -> "../openapi.yaml#/components/schemas/Foo"
    contentString = contentString.replace(
      /"#\/components\/(.*?)"/g,
      `"../openapi.yaml#/components/$1"`,
    );
  }

  return JSON.parse(contentString);
}

// ---------------------------------------------------------------------------
// Integración con Redocly CLI
// ---------------------------------------------------------------------------

/**
 * Ejecuta `redocly lint` sobre un archivo OpenAPI dado utilizando
 * el binario instalado como dependencia del propio CLI.
 *
 * @param {string} filePath - Ruta al archivo OAS principal a validar.
 */
async function validateWithRedocly(filePath) {
  console.log(chalk.cyan('\n🔍 Validando con Redocly (lint)...'));

  const redoclyPath = getBinPath('redocly');

  if (!fs.existsSync(redoclyPath)) {
    console.error(
      chalk.red(
        `\n✖ No se encontró el ejecutable de Redocly CLI en:\n   ${redoclyPath}\n`,
      ),
    );
    console.error(
      chalk.red(
        'Verifica la instalación de @apifactory/oas3-modularize y sus dependencias (incluyendo @redocly/cli).',
      ),
    );
    process.exit(1);
  }

  const command = `"${redoclyPath}" lint "${filePath}"`;

  try {
    const { stdout } = await execPromise(command, {
      cwd: process.cwd(),
      shell: true,
    });

    if (stdout.includes('validates successfully') || stdout.includes('No problems found!')) {
      console.log(chalk.green('✔ La estructura modular fue validada exitosamente por Redocly.'));

      // Mostrar advertencias si existen
      if (!stdout.includes('No problems found!')) {
        const warnings = stdout
          .split('\n')
          .filter((line) => line.toLowerCase().includes('warning'));
        if (warnings.length > 0) {
          console.log(chalk.yellow('\n⚠ Advertencias de Redocly:'));
          warnings.forEach((w) => console.log(chalk.yellow('  • ' + w.trim())));
        }
      }
    } else {
      console.log(stdout);
    }
  } catch (error) {
    const validationReport = error.stdout || error.message;

    console.error(chalk.red('\n✖ Error crítico de validación en Redocly:\n'));
    console.error((validationReport || '').trim());

    console.error(
      chalk.red(
        `\nEl archivo modularizado ${filePath} NO es válido según Redocly. Corrige los errores reportados y vuelve a intentarlo.`,
      ),
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Lógica principal de modularización
// ---------------------------------------------------------------------------

/**
 * Descompone un contrato OAS3 monolítico en:
 * - src/openapi.yaml           (entrypoint)
 * - src/components/*.yaml      (schemas, requestBodies, responses, etc.)
 * - src/paths/*.yaml           (un archivo por ruta)
 *
 * Luego ejecuta validación con Redocly CLI sobre el archivo modular principal.
 *
 * @param {string} inputPath - Ruta al archivo OAS3 de entrada.
 */
async function modularize(inputPath) {
  console.log(chalk.blue('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.blue(`🚀 Iniciando modularización de: ${inputPath}`));
  console.log(chalk.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  try {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`El archivo de entrada no se encontró en: ${inputPath}.`);
    }

    const fileContent = fs.readFileSync(inputPath, 'utf8');
    const oasData = yaml.load(fileContent);

    // Limpiar y crear directorios de salida
    if (fs.existsSync(TARGET_DIR)) {
      fs.rmSync(TARGET_DIR, { recursive: true, force: true });
      console.log(chalk.yellow(`ℹ Directorio existente eliminado: ${TARGET_DIR}`));
    }

    fs.mkdirSync(COMPONENTS_DIR, { recursive: true });
    fs.mkdirSync(PATHS_DIR, { recursive: true });
    console.log(chalk.green(`✔ Directorios creados en: ${TARGET_DIR}`));

    // Construir el nuevo objeto OAS principal (entrypoint)
    const newOas = {
      openapi: oasData.openapi,
      info: oasData.info,
      servers: oasData.servers || [],
      security: oasData.security || [],
      tags: oasData.tags || [],
      paths: {},
      components: {},
    };

    // Modularizar components
    const components = oasData.components || {};
    console.log(chalk.cyan('\n📦 Descomponiendo components:'));

    for (const [key, content] of Object.entries(components)) {
      if (content && Object.keys(content).length > 0) {
        const componentFileName = `${key}.yaml`;
        const componentFilePath = path.join(COMPONENTS_DIR, componentFileName);

        const fixedContent = fixRefs(content, key);
        writeYamlFile(componentFilePath, fixedContent);

        newOas.components[key] = {
          $ref: `./components/${componentFileName}`,
        };
      }
    }

    // Modularizar paths
    const originalPaths = oasData.paths || {};
    console.log(chalk.cyan('\n🗺  Descomponiendo paths:'));

    for (const [routePath, pathObject] of Object.entries(originalPaths)) {
      if (pathObject && Object.keys(pathObject).length > 0) {
        const pathFileName = slugifyPath(routePath);
        const pathFilePath = path.join(PATHS_DIR, pathFileName);

        const fixedPathObject = fixRefs(pathObject, 'paths');
        writeYamlFile(pathFilePath, fixedPathObject);

        newOas.paths[routePath] = {
          $ref: `./paths/${pathFileName}`,
        };
      } else {
        console.log(
          chalk.yellow(
            `  • Ruta ignorada por estar vacía: '${routePath}'`,
          ),
        );
      }
    }

    // Guardar archivo principal modular
    console.log(chalk.cyan('\n📝 Escribiendo archivo principal modular:'));
    writeYamlFile(MAIN_FILE, newOas);

    // Validar con Redocly
    await validateWithRedocly(MAIN_FILE);

    console.log(chalk.green('\n✨ Modularización completada exitosamente.'));
    console.log(chalk.green(`   Carpeta generada: ./${TARGET_DIR}`));
  } catch (error) {
    console.error(chalk.red('\n✖ Error al modularizar:'), error.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Bundle con Redocly
// ---------------------------------------------------------------------------

/**
 * Ejecuta `redocly bundle` sobre un archivo modular OpenAPI y escribe un bundle
 * único (normalmente en ./dist/openapi.yaml).
 *
 * Usa las opciones:
 *  - --dereferenced              (elimina $ref, expande todo)
 *  - --remove-unused-components  (minifica eliminando componentes no usados)
 *
 * @param {string} inputPath  Ruta al archivo principal modular (ej: src/openapi.yaml).
 * @param {string} outputPath Ruta al archivo bundle de salida (ej: dist/openapi.yaml).
 */
async function bundleWithRedocly(inputPath, outputPath) {
  console.log(chalk.cyan('\n📦 Generando bundle con Redocly...'));

  const redoclyPath = getBinPath('redocly');

  if (!fs.existsSync(redoclyPath)) {
    console.error(
      chalk.red(
        `\n✖ No se encontró el ejecutable de Redocly CLI en:\n   ${redoclyPath}\n`,
      ),
    );
    console.error(
      chalk.red(
        'Verifica la instalación de @apifactory/oas3-modularize y sus dependencias (incluyendo @redocly/cli).',
      ),
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const command = `"${redoclyPath}" bundle "${inputPath}" --dereferenced --remove-unused-components -o "${outputPath}"`;

  try {
    const { stdout } = await execPromise(command, {
      cwd: process.cwd(),
      shell: true,
    });
    console.log(stdout);
    console.log(chalk.green(`✔ Bundle generado en: ${outputPath}`));
  } catch (error) {
    console.error(chalk.red('\n✖ Error al hacer bundle con Redocly:'));
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Documentación Markdown con Widdershins
// ---------------------------------------------------------------------------

/**
 * Ejecuta Widdershins para convertir un archivo OpenAPI (bundle único)
 * en documentación Markdown.
 *
 * @param {string} inputPath  Ruta al archivo OpenAPI de entrada (ej: dist/openapi.yaml).
 * @param {string} outputPath Ruta al archivo Markdown de salida (ej: dist/api.md).
 */
async function generateMarkdownDocs(inputPath, outputPath) {
  console.log(chalk.cyan('\n📝 Generando documentación Markdown con Widdershins...'));

  const widdershinsPath = getBinPath('widdershins');

  if (!fs.existsSync(widdershinsPath)) {
    console.error(
      chalk.red(
        `\n✖ No se encontró el ejecutable de Widdershins en:\n   ${widdershinsPath}\n`,
      ),
    );
    console.error(
      chalk.red(
        'Verifica la instalación de @apifactory/oas3-modularize y sus dependencias (incluyendo widdershins).',
      ),
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const command = `"${widdershinsPath}" "${inputPath}" -o "${outputPath}"`;

  try {
    const { stdout } = await execPromise(command, {
      cwd: process.cwd(),
      shell: true,
    });
    console.log(stdout);
    console.log(chalk.green(`✔ Documentación Markdown generada en: ${outputPath}`));
  } catch (error) {
    console.error(chalk.red('\n✖ Error al generar documentación con Widdershins:'));
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Menú interactivo con Inquirer
// ---------------------------------------------------------------------------

/**
 * Muestra un menú interactivo para que el usuario no tenga que memorizar comandos.
 */
async function showMenu() {
  console.log(chalk.bold.cyan('\n🧩 oas3-modularize - Menú interactivo\n'));

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '¿Qué quieres hacer?',
      choices: [
        {
          name: '1) Modularizar desde un archivo OpenAPI YAML único',
          value: 'modularize',
        },
        {
          name: '2) Generar bundle (dereferenced + remove-unused-components) con Redocly',
          value: 'bundle',
        },
        {
          name: '3) Generar documentación Markdown desde el bundle',
          value: 'docs',
        },
        {
          name: '4) Ejecutar todo el pipeline (modularizar → bundle → docs)',
          value: 'build-all',
        },
        {
          name: 'Salir',
          value: 'exit',
        },
      ],
    },
  ]);

  if (action === 'exit') {
    console.log(chalk.gray('\n👋 Saliendo...'));
    return;
  }

  switch (action) {
    case 'modularize': {
      const { input } = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: 'Ruta al archivo OpenAPI YAML de entrada:',
          default: './openapi.yaml',
        },
      ]);
      await modularize(input);
      break;
    }

    case 'bundle': {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: 'Archivo modular principal (entrypoint):',
          default: MAIN_FILE,
        },
        {
          type: 'input',
          name: 'output',
          message: 'Ruta de salida del bundle:',
          default: path.join(DIST_DIR, 'openapi.yaml'),
        },
      ]);
      await bundleWithRedocly(answers.input, answers.output);
      break;
    }

    case 'docs': {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: 'Archivo OpenAPI de entrada (normalmente el bundle):',
          default: path.join(DIST_DIR, 'openapi.yaml'),
        },
        {
          type: 'input',
          name: 'output',
          message: 'Ruta de salida del Markdown:',
          default: path.join(DIST_DIR, 'api.md'),
        },
      ]);
      await generateMarkdownDocs(answers.input, answers.output);
      break;
    }

    case 'build-all': {
      const { input } = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: 'Ruta al archivo OpenAPI YAML de entrada para el pipeline completo:',
          default: './openapi.yaml',
        },
      ]);
      await modularize(input);
      await bundleWithRedocly(MAIN_FILE, path.join(DIST_DIR, 'openapi.yaml'));
      await generateMarkdownDocs(
        path.join(DIST_DIR, 'openapi.yaml'),
        path.join(DIST_DIR, 'api.md'),
      );
      break;
    }

    default:
      console.log(chalk.red('Opción no reconocida.'));
  }

  console.log(chalk.bold.green('\n✅ Operación finalizada.\n'));
}

// ---------------------------------------------------------------------------
// Definición de CLI (Commander) + fallback al menú
// ---------------------------------------------------------------------------

program
  .name('oas3-modularize')
  .description(
    'Utilidades para OAS3: modularizar, validar con Redocly, hacer bundle y generar docs Markdown.',
  )
  .version('1.2.0');

// Subcomando: modularizar
program
  .command('modularize')
  .requiredOption(
    '--build <file>',
    'Ruta al archivo OpenAPI YAML de entrada (ej: ./openapi.yaml)',
  )
  .description('Descompone un único archivo OAS3 YAML en una estructura modular (src/) y valida.')
  .action(async (options) => {
    await modularize(options.build);
  });

// Subcomando: bundle
program
  .command('bundle')
  .option('-i, --input <file>', 'Archivo modular principal de entrada', MAIN_FILE)
  .option('-o, --output <file>', 'Archivo bundle de salida', path.join(DIST_DIR, 'openapi.yaml'))
  .description(
    'Genera un bundle único desde la estructura modular usando Redocly (dereferenced + remove-unused-components).',
  )
  .action(async (options) => {
    await bundleWithRedocly(options.input, options.output);
  });

// Subcomando: docs
program
  .command('docs')
  .option(
    '-i, --input <file>',
    'Archivo OpenAPI de entrada (normalmente el bundle)',
    path.join(DIST_DIR, 'openapi.yaml'),
  )
  .option(
    '-o, --output <file>',
    'Archivo Markdown de salida',
    path.join(DIST_DIR, 'api.md'),
  )
  .description('Genera documentación Markdown desde un archivo OpenAPI usando Widdershins.')
  .action(async (options) => {
    await generateMarkdownDocs(options.input, options.output);
  });

// Subcomando: pipeline completo
program
  .command('build-all')
  .requiredOption(
    '--build <file>',
    'Ruta al archivo OpenAPI YAML de entrada (ej: ./openapi.yaml)',
  )
  .description(
    'Ejecuta el pipeline completo: modularizar → bundle (Redocly) → docs (Markdown con Widdershins).',
  )
  .action(async (options) => {
    await modularize(options.build);
    await bundleWithRedocly(MAIN_FILE, path.join(DIST_DIR, 'openapi.yaml'));
    await generateMarkdownDocs(
      path.join(DIST_DIR, 'openapi.yaml'),
      path.join(DIST_DIR, 'api.md'),
    );
  });

// Si el usuario pasa argumentos, usamos Commander;
// si no, mostramos el menú interactivo.
if (process.argv.length <= 2) {
  showMenu().catch((err) => {
    console.error(chalk.red('\n✖ Error en el menú interactivo:'), err);
    process.exit(1);
  });
} else {
  program.parse(process.argv);
}
