# Leadscan — como instalar e usar (Windows)

Este guia é para quem vai **usar** o programa, não para programadores.
Você só precisa fazer a parte 1 uma única vez.

---

## Parte 1 — Instalar (só na primeira vez)

### 1. Instale o Node.js

O programa precisa do Node.js para funcionar. É gratuito e leva 2 minutos.

1. Abra <https://nodejs.org>
2. Clique no botão grande que diz **LTS**
3. Abra o arquivo baixado e clique em **Avançar** até o fim
4. Pode aceitar todas as opções que já vêm marcadas

### 2. Coloque a pasta do Leadscan no computador

Descompacte a pasta que você recebeu em algum lugar fácil de achar,
por exemplo em **Documentos**.

> Não deixe a pasta dentro do Downloads nem na Área de Trabalho do OneDrive —
> o programa guarda arquivos aí dentro e o OneDrive costuma atrapalhar.

### 3. Rode o instalador

Dentro da pasta, dê **dois cliques em `Instalar`**.

Vai abrir uma janela preta com texto passando. Isso é normal.
Quando aparecer **"Pronto!"**, pode fechar.

Um atalho chamado **Leadscan** aparece na sua Área de Trabalho.

---

## Parte 2 — Criar as duas contas (só na primeira vez)

O Leadscan usa duas contas **suas**. Você paga só pelo que usar, e ninguém
além de você tem acesso a elas.

### Conta 1 — Apify (busca os perfis do LinkedIn)

1. Crie a conta em <https://console.apify.com/sign-up>
2. Depois de entrar, vá em **Settings → Integrations**
3. Copie o código que aparece em **Personal API token**

### Conta 2 — OpenRouter (faz a avaliação com IA)

1. Crie a conta em <https://openrouter.ai>
2. Vá em **Credits** e adicione crédito
3. Vá em <https://openrouter.ai/keys> e clique em **Create Key**
4. Copie o código que aparece

> **Guarde os dois códigos.** Eles começam com `apify_api_...` e `sk-or-v1-...`.
> Se você marcar "Lembrar neste computador" na próxima etapa, só vai precisar
> deles uma vez.

---

## Parte 3 — Usar

1. Dê **dois cliques no atalho Leadscan** da Área de Trabalho
2. Uma janela preta abre e o navegador abre sozinho
3. Na primeira vez, cole os dois códigos e clique em **Conectar**
4. Pronto: importe o CSV da campanha, defina os critérios e mande avaliar

**Enquanto estiver usando, deixe a janela preta aberta.**
Para fechar o programa, feche essa janela.

---

## Perguntas comuns

**A janela preta fechou sozinha / apareceu um erro vermelho.**
Tire um print da janela inteira e mande para quem te passou o programa.

**O navegador abriu dizendo que não conseguiu se conectar.**
Espere 10 segundos e atualize a página (F5). O programa demora um pouco
para ligar na primeira vez.

**Apareceu um aviso amarelo sobre saldo da OpenRouter.**
Seu crédito está acabando. Entre em <https://openrouter.ai/credits> e
adicione mais antes de rodar a campanha, senão parte dos perfis volta
sem avaliação.

**Pediu as chaves de novo.**
Ou você não marcou "Lembrar neste computador", ou uma das chaves parou de
funcionar. É só colar de novo.

**Quero usar em outro computador.**
Repita a Parte 1 nele. Suas campanhas ficam salvas em cada computador
separadamente, não são sincronizadas.

---

## Onde ficam seus dados

Tudo fica **no seu computador**, dentro da pasta do Leadscan:
as campanhas importadas, os perfis coletados e os resultados.
Nada é enviado para ninguém além da Apify e da OpenRouter, que são as
suas próprias contas.
