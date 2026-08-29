/**
 * _lib/documento.js — validação de CPF e CNPJ.
 *
 * O documento é a identidade do lead: alimenta o contexto da IA no
 * dossiê e é o que impede duplicidade. Por isso a validação usa o
 * dígito verificador, não apenas a contagem de dígitos — um número
 * digitado errado quase sempre falha nessa conta.
 *
 * Vive aqui, e não dentro de uma rota, porque o cadastro manual e a
 * importação em lote precisam da mesma regra. Duas cópias divergiriam.
 */

export function soDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function cnpjValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  const calcular = (base, pesoInicial) => {
    let soma = 0;
    let peso = pesoInicial;
    for (const digito of base) {
      soma += Number(digito) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(c.slice(0, 12), 5) === Number(c[12])
      && calcular(c.slice(0, 13), 6) === Number(c[13]);
}

export function cpfValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const dv = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(c[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };

  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/** Aceita CPF (11 dígitos) ou CNPJ (14). */
export function documentoValido(valor) {
  const d = soDigitos(valor);
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

export function formatarDocumento(valor) {
  const d = soDigitos(valor);
  if (d.length === 14) {
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }
  return valor || '';
}
