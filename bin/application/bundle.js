// bin/application/bundle.js

const path = require('path');
const chalk = require('chalk');

const { resolveExecutable } = require('../infrastructure/executables');
const { ensureDir, removeDirIfExists } = require('../infrastructure/fileSystem');
const { runCommand } = require('../infrastructure/runCommand');
const { loadAllConfigs } = require('../infrastructure/configLoader');
const { readYamlFile, writeYamlFile } = require('../infrastructure/yamlUtils');

/**
 * -----------------------------------------------------------
 * ACLARACIÓN IMPORTANTE SOBRE CONFIG vs FLAGS/INPUT
 * -----------------------------------------------------------
 *
 * - Los valores definidos en `config/bundle.yaml` funcionan como:
 *      ✔ placeholders
 *      ✔ ejemplos
 *      ✔ valores sugeridos por defecto (por ejemplo para el menú)
 *
 * - El usuario SIEMPRE puede sobreescribir rutas de entrada/salida
 *   mediante:
 *      👉 flags del CLI (p.ej. `-i`, `-o`)
 *      👉 respuestas en el menú interactivo
 *
 * - PRIORIDAD DE VALORES:
 *      1) Valor ingresado por el usuario (flags / input)
 *      2) Valor definido en `config/bundle.yaml`
 *
 * - Si un valor es OBLIGATORIO (como la ruta de salida)
 *   y no viene ni por CLI/input ni por config:
 *      → se lanza un error claro.
 *
 * - Para flags de comportamiento (dereference, removeUnusedComponents, etc.)
 *   existen defaults técnicos internos. El config los sobreescribe si está presente.
 */

// ---------------------------------------------------------
// CARGA CONFIGURACIÓN (OPCIONAL) DE BUNDLE
// ---------------------------------------------------------
const configs = loadAllConfigs();
const bundleRootConfig = configs.bundle || {}; // puede no existir

const pathsConfig = bundleRootConfig.paths || {};
const behaviorConfig = bundleRootConfig.behavior || {};
const bundleConfig = bundleRootConfig.bundle || {};

// Defaults técnicos para el comportamiento del bundle
const DEFAULTS = {
  cleanDist: true,
  dereference: false,             // evitar anchors y ciclos por defecto
  removeUnusedComponents: false,  // solo se activa si el usuario lo pide en config
  injectFormat: false,
  validate: true,
};

function assertOptionalBoolean(obj, field, context) {
  if (obj[field] !== undefined && typeof obj[field] !== 'boolean') {
    throw new Error(
      `❌ El campo ${context}.${field} debe ser booleano si se define (valor actual: ${JSON.stringify(
        obj[field],
      )})`,
    );
  }
}

// Validamos tipos SOLO si están definidos en config
assertOptionalBoolean(behaviorConfig, 'cleanDist', 'config.bundle.behavior');
assertOptionalBoolean(bundleConfig, 'dereference', 'config.bundle.bundle');
assertOptionalBoolean(bundleConfig, 'removeUnusedComponents', 'config.bundle.bundle');
assertOptionalBoolean(bundleConfig, 'injectFormat', 'config.bundle.bundle');
assertOptionalBoolean(bundleConfig, 'validate', 'config.bundle.bundle');

// Comportamiento efectivo (config sobreescribe defaults)
const CLEAN_DIST =
  typeof behaviorConfig.cleanDist === 'boolean'
    ? behaviorConfig.cleanDist
    : DEFAULTS.cleanDist;

const DEREF =
  typeof bundleConfig.dereference === 'boolean'
    ? bundleConfig.dereference
    : DEFAULTS.dereference;

const REMOVE_UNUSED =
  typeof bundleConfig.removeUnusedComponents === 'boolean'
    ? bundleConfig.removeUnusedComponents
    : DEFAULTS.removeUnusedComponents;

const INJECT_FORMAT =
  typeof bundleConfig.injectFormat === 'boolean'
    ? bundleConfig.injectFormat
    : DEFAULTS.injectFormat;

const VALIDATE =
  typeof bundleConfig.validate === 'boolean'
    ? bundleConfig.validate
    : DEFAULTS.validate;

// ---------------------------------------------------------
// EJECUTA REDOCLY BUNDLE
// ---------------------------------------------------------
/**
 * Paso 1: genera un bundle "plano" (sin remove-unused-components).
 * Paso 2 (opcional): si REMOVE_UNUSED === true,
 *                    ejecuta una segunda pasada de Redocly para eliminar
 *                    los components no usados sobre el bundle ya generado.
 * Paso 3 (opcional): si !DEREF, reescribe el YAML sin anchors (&ref_*).
 *
 * NOTA sobre rutas:
 *   - inputPath SIEMPRE viene del CLI o menú (es obligatorio).
 *   - outputPath (si viene por CLI/menú) tiene prioridad.
 *   - si no se pasa outputPath, se intenta usar config.bundle.paths.bundleOutput.
 *   - si no existe ninguna de las dos → error.
 */
async function bundleWithRedocly(inputPath, outputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('❌ Debes indicar un entrypoint válido para el bundle (inputPath).');
  }

  const configOutput = pathsConfig.bundleOutput;
  const finalOutput = outputPath || configOutput;

  if (!finalOutput || typeof finalOutput !== 'string') {
    throw new Error(
      '❌ Debes especificar la ruta de salida del bundle:\n' +
        '   - vía CLI:   oas3-modularize bundle -o ./dist/openapi.yaml\n' +
        '   - o en config/bundle.yaml → bundle.paths.bundleOutput',
    );
  }

  console.log(chalk.cyan('\n📦 Generando bundle con Redocly...\n'));

  const redoclyPath = resolveExecutable('redocly');

  if (!redoclyPath) {
    console.error(chalk.red('\n✖ No se encontró Redocly CLI en node_modules/.bin.'));
    console.error(
      chalk.red('Instala @redocly/cli o verifica que las dependencias estén instaladas.'),
    );
    process.exit(1);
  }

  const distDir = path.dirname(finalOutput);

  if (CLEAN_DIST) {
    removeDirIfExists(distDir);
  }
  ensureDir(distDir);

  // -----------------------------------------------------
  // PASO 1: bundle "plano" (sin remove-unused-components)
  // -----------------------------------------------------
  const flagsPaso1 = [];

  if (DEREF) flagsPaso1.push('--dereferenced');
  if (INJECT_FORMAT) flagsPaso1.push('--inject-format');
  if (!VALIDATE) flagsPaso1.push('--skip-rule=all');

  const commandPaso1 = [
    `"${redoclyPath}"`,
    'bundle',
    `"${inputPath}"`,
    '-o',
    `"${finalOutput}"`,
    ...flagsPaso1,
  ].join(' ');

  console.log(
    chalk.gray('ℹ Ejecutando paso 1: bundle plano (sin --remove-unused-components)...'),
  );
  const { stdout: stdout1 } = await runCommand(commandPaso1);
  if (stdout1 && stdout1.trim()) console.log(stdout1);

  // -----------------------------------------------------
  // PASO 2 (opcional): remove-unused-components sobre el bundle ya generado
  // -----------------------------------------------------
  if (REMOVE_UNUSED) {
    console.log(
      chalk.gray(
        'ℹ Ejecutando paso 2: limpieza de components no usados (--remove-unused-components) sobre el bundle generado...',
      ),
    );

    const flagsPaso2 = [];

    // Aquí NO agregamos --dereferenced ni --inject-format:
    // solo queremos que Redocly identifique y elimine components no usados.
    if (!VALIDATE) flagsPaso2.push('--skip-rule=all');
    flagsPaso2.push('--remove-unused-components');

    const commandPaso2 = [
      `"${redoclyPath}"`,
      'bundle',
      `"${finalOutput}"`, // input: el bundle ya generado en el paso 1
      '-o',
      `"${finalOutput}"`, // output: se sobrescribe el mismo archivo
      ...flagsPaso2,
    ].join(' ');

    const { stdout: stdout2 } = await runCommand(commandPaso2);
    if (stdout2 && stdout2.trim()) console.log(stdout2);
  }

  // -----------------------------------------------------
  // PASO 3 (opcional): reescritura sin anchors YAML
  // -----------------------------------------------------
  // Solo tiene sentido hacerlo cuando NO está dereferenciado.
  if (!DEREF) {
    try {
      const bundledObject = readYamlFile(finalOutput);
      writeYamlFile(finalOutput, bundledObject);
      console.log(chalk.gray('ℹ Bundle reescrito sin anchors YAML (noRefs:true).'));
    } catch (postErr) {
      console.warn(
        chalk.yellow(
          `⚠ No se pudo reescribir el bundle sin anchors: ${postErr.message || postErr}`,
        ),
      );
    }
  } else {
    console.log(
      chalk.gray(
        'ℹ Bundle dereferenciado: se omite reescritura sin anchors para evitar ciclos.',
      ),
    );
  }

  console.log(chalk.bold.green(`\n✅ Bundle generado en: ${finalOutput}\n`));
}

module.exports = {
  bundleWithRedocly,
};
