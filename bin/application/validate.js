// bin/application/validate.js

const chalk = require('chalk');
const { resolveExecutable } = require('../infrastructure/executables');
const { runCommand } = require('../infrastructure/runCommand');

/**
 * Ejecuta `redocly lint` sobre un archivo OpenAPI dado.
 *
 * @param {string} filePath - Ruta al archivo OAS principal a validar.
 */
async function validateWithRedocly(filePath) {
  console.log(chalk.cyan('\n🔍 Validando con Redocly (lint)...'));

  const redoclyPath = resolveExecutable('redocly');

  if (!redoclyPath) {
    throw new Error(
      'No se encontró el ejecutable de Redocly CLI. Asegúrate de que @redocly/cli esté instalado como dependencia.'
    );
  }

  const command = `"${redoclyPath}" lint "${filePath}"`;

  try {
    const { stdout } = await runCommand(command);

    // Detección genérica de mensaje de éxito
    if (/valid/i.test(stdout) || /no problems/i.test(stdout)) {
      console.log(chalk.green('✔ La estructura modular valida exitosamente ante Redocly.'));

      // Mostrar warnings si existen
      const warnings = stdout
        .split('\n')
        .filter((line) => line.toLowerCase().includes('warning'));

      if (warnings.length > 0) {
        console.log(chalk.yellow('\n⚠ Advertencias de Redocly:'));
        warnings.forEach((w) => console.log('  • ' + chalk.yellow(w.trim())));
      }

      return; // ok
    }

    // Si no matchea éxito, imprime el stdout completo
    console.log(stdout);
  } catch (error) {
    const report = error.stdout || error.message || '';

    throw new Error(
      `Error de validación Redocly:\n\n${report}\n\nEl archivo ${filePath} NO es válido.`
    );
  }
}

module.exports = {
  validateWithRedocly,
};
