# Foque em Checks

Aplicação estática de organização de tarefas, modo foco e sincronização por usuário
com Supabase.

## Estrutura

- `index.html`: modo foco.
- `organizer.html`: organizador de tarefas, blocos, subtarefas, recorrência e importação de PDF.
- `login.html`: autenticação.
- `assets/css/`: estilos compartilhados.
- `assets/js/`: configuração pública e sincronização com Supabase.
- `assets/img/`: imagens utilizadas pela interface.
- `database/`: esquema e políticas do Supabase.
- `docs/`: instruções de configuração, segurança e recuperação.
- `scripts/`: verificações locais sem dependências externas.

## Execução local

Sirva a raiz do projeto por HTTP (por exemplo, com Live Server) e abra
`login.html`. Não abra os arquivos diretamente por `file://`.

Para verificar sintaxe JavaScript, referências locais e exposição acidental de uma
chave secreta, execute:

```text
node scripts/check-project.cjs
node scripts/check-recurrence.cjs
```

Antes de publicar, siga `docs/CONFIGURAR_SUPABASE.md` e mantenha no navegador
somente a chave pública (`sb_publishable_...`). Nunca publique uma chave
`service_role` ou `secret`.

## Proteção dos dados

O Foque em Checks mantém uma cópia por usuário no navegador, cinco versões locais anteriores
e, depois da aplicação do SQL atual, 30 versões anteriores no Supabase. A
sincronização usa atualização condicional para impedir que uma aba antiga substitua
silenciosamente uma versão mais nova.

Consulte `docs/AUDITORIA_SEGURANCA.md` para o diagnóstico completo e
`docs/SEGURANCA_E_BACKUP.md` antes de alterar persistência ou políticas.
