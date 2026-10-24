# Finanças do casal / Couple's finance app

**PT** · App web simples para dois (Francisco, Carolina e "Juntos"), em localhost/Wi-Fi de casa. Sem login, sem dependências: só Node.js e um ficheiro SQLite.
**EN** · Small web app for two people on a home network. No login, zero npm dependencies: just Node.js and one SQLite file.

## Passo a passo num computador pessoal / Step by step (Windows & Mac)

1. **Instalar o Node.js 22.18 ou superior** (versão LTS) em https://nodejs.org. Confirme num terminal: `node -v` (deve mostrar `v22.18` ou mais).
   - **Windows:** abra o *PowerShell* (menu Iniciar > "PowerShell").
   - **Mac:** abra a app *Terminal* (Cmd+Espaço > "Terminal").
2. **Instalar o Git** se não tiver: Windows https://git-scm.com/download/win · Mac: ao correr `git` pela primeira vez, aceite a instalação das ferramentas de linha de comandos.
3. **Descarregar o código e mudar para o ramo da app:**
   ```bash
   git clone https://github.com/ElPapiSanchez/ElPapiSanchez.git financas
   cd financas
   git checkout cursor/couple-finance-app-33ff
   ```
   (Depois de o PR ser aceite, o ramo `main` já tem tudo e não precisa do `checkout`.)
4. **Arrancar:** `npm start` (não é preciso `npm install`).
5. **Abrir** `http://localhost:3000` no browser. O outro dispositivo usa o endereço "Na rede Wi-Fi" mostrado no terminal.
6. Para parar: `Ctrl+C`. Para voltar a arrancar: abra o terminal na pasta `financas` e corra `npm start`.

EN: install Node 22.18+, install Git, `git clone` the repo, `git checkout cursor/couple-finance-app-33ff`, run `npm start`, open http://localhost:3000.

## Como correr / Running it

Precisa de Node.js 22.18 ou superior (`node -v`). / Needs Node.js ≥ 22.18.

```bash
npm start
```

Abra `http://localhost:3000`. O terminal imprime também o endereço para o outro dispositivo, por exemplo:
`Na rede Wi-Fi (outro dispositivo): http://192.168.1.23:3000`.
Opções: `PORT=4000 npm start`. Testes: `npm test`.

### Ligar a partir do outro computador / Connecting from the other device
1. Os dois dispositivos na mesma rede Wi-Fi.
2. No computador que corre a app, use o URL "Na rede Wi-Fi" impresso ao arrancar.
   Se não aparecer, descubra o IP: **Windows** `ipconfig` (Endereço IPv4) · **macOS** `ipconfig getifaddr en0` · **Linux** `hostname -I`.
3. No outro dispositivo abra `http://<IP-do-anfitrião>:3000`.
4. Se não ligar, permita o Node.js na firewall (rede privada). A app não tem login: use apenas em redes de confiança.

## Cópia de segurança / Backup
Todos os dados estão em `data/financas.sqlite` (mais `-wal`/`-shm` enquanto a app corre).
Pare a app (Ctrl+C) e copie `data/financas.sqlite` para um local seguro (pen, nuvem). Para restaurar, volte a pôr o ficheiro em `data/`.
Outro ficheiro: `DB_FILE=/caminho/ficheiro.sqlite npm start`.
EN: stop the app and copy `data/financas.sqlite`; to restore, put it back.

## Como funciona / Notes
- Valores em cêntimos inteiros (sem erros de vírgula flutuante). Meses só aparecem quando têm dados.
- Editar um item recorrente aplica-se do mês escolhido em diante; meses anteriores ficam iguais.
- Subsídio de refeição: valor mensal por pessoa, nunca é dinheiro livre nem pode ser poupado/investido. O gasto em categorias de alimentação (Restaurantes, Mercearia) "pago com subsídio" sai das despesas em dinheiro, evitando contar duas vezes.
- Subsídios de férias (junho) e Natal (novembro) são gerados todos os anos; em *Recorrentes* desmarque um ano para o ignorar.
- Despesas partilhadas: pagas pela conta partilhada ou por uma pessoa (mostra quanto o outro deve); divisão proporcional aos salários, ajustável.
- Saldos iniciais: em *Metas e definições* indique a poupança que já têm (por pessoa, fundo da mudança e outras poupanças). Conta para as metas sem criar meses antigos; o histórico começa no mês em que usar a app pela primeira vez.
- Exportar CSV/Excel: separador *Metas e definições*.
- Código: `src/calc.ts` (cálculos), `src/db.ts`, `src/api.ts`, `src/server.ts`, `public/` (interface).
