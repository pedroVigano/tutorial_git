// Pontos de ligação entre módulos (definidos em main.js), para evitar dependência circular na carga.
export const hooks = {
  render: () => {},
  reload: async () => {},
  drawArrows: () => {},
};

// Registro das gravações feitas nesta sessão (painel "Gravações no Notion").
export const writeLog = [];
