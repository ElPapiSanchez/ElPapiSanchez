# Finanças do casal / Couple's finance app

**PT** · App web simples para dois (Francisco, Carolina e "Juntos"), em localhost/Wi-Fi de casa. Sem login, sem dependências: só Node.js e um ficheiro SQLite.
**EN** · Small web app for two people on a home network. No login, zero npm dependencies: just Node.js and one SQLite file.

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
- Exportar CSV/Excel: separador *Metas e definições*.
- Código: `src/calc.ts` (cálculos), `src/db.ts`, `src/api.ts`, `src/server.ts`, `public/` (interface).
