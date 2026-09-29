// seed-data.js — datos de demo
module.exports.PRODUCTOS = [
  { nombre: 'Tabla de fiambres',       precio: 4200, categoria: 'Entradas',     stock: 30, activo: 1, descripcion: 'Jamon crudo, salami, queso brie y tostadas' },
  { nombre: 'Provoleta parrilla',      precio: 3100, categoria: 'Entradas',     stock: 40, activo: 1, descripcion: 'Provolone grillado con oregano y tomate cherry' },
  { nombre: 'Empanadas x4',            precio: 2800, categoria: 'Entradas',     stock: 50, activo: 1, descripcion: 'Carne a cuchillo, humita o jamon y queso' },
  { nombre: 'Ceviche de langostinos',  precio: 5500, categoria: 'Entradas',     stock: 20, activo: 1, descripcion: 'Con limon, cilantro y aji' },
  { nombre: 'Bife de chorizo',         precio: 9800, categoria: 'Principales',  stock: 25, activo: 1, descripcion: '350g con guarnicion y chimichurri casero' },
  { nombre: 'Bondiola braseada',       precio: 8400, categoria: 'Principales',  stock: 20, activo: 1, descripcion: 'Coccion lenta 8hs, pure de batata y vino' },
  { nombre: 'Pollo a la portuguesa',   precio: 7200, categoria: 'Principales',  stock: 30, activo: 1, descripcion: 'Suprema con salsa de tomates y aceitunas' },
  { nombre: 'Risotto de hongos',       precio: 7800, categoria: 'Principales',  stock: 15, activo: 1, descripcion: 'Arroz arborio, hongos, parmesano y trufa' },
  { nombre: 'Pasta fresca del dia',    precio: 6500, categoria: 'Principales',  stock: 20, activo: 1, descripcion: 'Consultar rellenos y salsas del dia' },
  { nombre: 'Hamburguesa artesanal',   precio: 6200, categoria: 'Principales',  stock: 35, activo: 1, descripcion: '200g res, cheddar, panceta y papas' },
  { nombre: 'Ensalada Cesar',          precio: 4800, categoria: 'Ensaladas',    stock: 30, activo: 1, descripcion: 'Lechuga romana, pollo grillado y croutons' },
  { nombre: 'Ensalada caprese',        precio: 4200, categoria: 'Ensaladas',    stock: 25, activo: 1, descripcion: 'Tomate, mozzarella fresca y albahaca' },
  { nombre: 'Ensalada de estacion',    precio: 3900, categoria: 'Ensaladas',    stock: 30, activo: 1, descripcion: 'Mixta con frutos secos y miel mostaza' },
  { nombre: 'Lava cake chocolate',     precio: 3200, categoria: 'Postres',      stock: 20, activo: 1, descripcion: 'Con helado de vainilla y coulis de frambuesa' },
  { nombre: 'Tiramisu casero',         precio: 2900, categoria: 'Postres',      stock: 15, activo: 1, descripcion: 'Mascarpone y amaretto, receta original' },
  { nombre: 'Panqueques dulce leche',  precio: 2600, categoria: 'Postres',      stock: 25, activo: 1, descripcion: 'Con helado de crema americana' },
  { nombre: 'Agua mineral 500ml',      precio:  800, categoria: 'Bebidas',      stock:100, activo: 1, descripcion: 'Con o sin gas' },
  { nombre: 'Gaseosa lata',            precio:  900, categoria: 'Bebidas',      stock: 80, activo: 1, descripcion: 'Coca-Cola, Sprite o Fanta' },
  { nombre: 'Limonada artesanal',      precio: 1400, categoria: 'Bebidas',      stock: 40, activo: 1, descripcion: 'Con jengibre y menta fresca' },
  { nombre: 'Vino por copa',           precio: 2200, categoria: 'Bebidas',      stock: 60, activo: 1, descripcion: 'Malbec o Cabernet - Mendoza' },
  { nombre: 'Botella vino tinto',      precio: 7500, categoria: 'Bebidas',      stock: 30, activo: 1, descripcion: 'Trapiche Reserva Malbec 750ml' },
  { nombre: 'Cerveza artesanal pinta', precio: 2400, categoria: 'Bebidas',      stock: 50, activo: 1, descripcion: 'Rubia, Amber Ale o Stout' },
  { nombre: 'Jugo natural',            precio: 1600, categoria: 'Bebidas',      stock: 40, activo: 1, descripcion: 'Naranja, pomelo o anana al momento' },
  { nombre: 'Papas fritas',            precio: 1800, categoria: 'Guarniciones', stock: 60, activo: 1, descripcion: 'Caseras con sal gruesa y chimichurri' },
  { nombre: 'Pure de papas',           precio: 1500, categoria: 'Guarniciones', stock: 40, activo: 1, descripcion: 'Cremoso con manteca y nuez moscada' },
  { nombre: 'Ensalada mixta',          precio: 1400, categoria: 'Guarniciones', stock: 40, activo: 1, descripcion: 'Lechuga, tomate, cebolla y zanahoria' },
  { nombre: 'Arroz blanco',            precio: 1200, categoria: 'Guarniciones', stock: 50, activo: 1, descripcion: 'Con hierbas frescas' },
];

module.exports.CLIENTES = [
  { nombre: 'Maria Gonzalez',    telefono: '11 5234-6789', email: 'maria.g@gmail.com',      direccion: 'Av. Santa Fe 2345, CABA',  notas: 'VIP - sin gluten' },
  { nombre: 'Carlos Rodriguez',  telefono: '11 4876-3210', email: 'carlos.r@hotmail.com',   direccion: 'Corrientes 890, CABA',     notas: 'Prefiere mesa en terraza' },
  { nombre: 'Ana Martinez',      telefono: '11 6543-2109', email: 'ana.martinez@gmail.com', direccion: 'Palermo, CABA',            notas: '' },
  { nombre: 'Diego Fernandez',   telefono: '11 3214-5678', email: 'diego.f@empresa.com.ar', direccion: 'Puerto Madero, CABA',      notas: 'Almuerzo de trabajo' },
  { nombre: 'Laura Sanchez',     telefono: '11 7890-1234', email: 'laurita.s@gmail.com',    direccion: 'Belgrano, CABA',           notas: 'Alergica a mariscos' },
  { nombre: 'Martin Lopez',      telefono: '11 9012-3456', email: 'martin.lopez@gmail.com', direccion: 'Nunez, CABA',              notas: '' },
  { nombre: 'Sofia Pereyra',     telefono: '11 2345-6780', email: 'sofi.p@yahoo.com.ar',    direccion: 'Recoleta, CABA',           notas: 'Cumpleanos el 15/10' },
  { nombre: 'TechSoluciones SA', telefono: '11 4000-5000', email: 'admin@techsol.com.ar',   direccion: 'Microcentro, CABA',        notas: 'Factura A - cuenta corporativa' },
];

module.exports.USUARIOS = [
  { nombre: 'Lucas Mozo',     email: 'lucas@labuenamese.com.ar',   password: 'demo1234', rol: 'vendedor' },
  { nombre: 'Valeria Cocina', email: 'valeria@labuenamese.com.ar', password: 'demo1234', rol: 'vendedor' },
  { nombre: 'Roberto Caja',   email: 'roberto@labuenamese.com.ar', password: 'demo1234', rol: 'vendedor' },
];
