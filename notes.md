# Learning notes

## JWT Pizza code study and debugging

As part of `Deliverable ⓵ Development deployment: JWT Pizza`, start up the application and debug through the code until you understand how it works. During the learning process fill out the following required pieces of information in order to demonstrate that you have successfully completed the deliverable.

| User activity                                       | Frontend component | Backend endpoints | Database SQL |
| --------------------------------------------------- | ------------------ | ----------------- | ------------ |
| View home page                                      | src/views/home.tsx — Home                               | GET / |  |
| Register new user<br/>(t@jwt.com, pw: test)         | src/views/register.tsx — Register                       | POST /api/auth | INSERT: user, userRole, auth |
| Login new user<br/>(t@jwt.com, pw: test)            | src/views/login.tsx — Login                             | PUT /api/auth | SELECT: user, userRole; INSERT: auth |
| Order pizza                                         | src/views/menu.tsx — Menu (select pizzas)               | GET /api/order/menu | GET /api/franchise | POST /api/order | SELECT: menu, franchise, store; INSERT: dinerOrder, orderItem
| Verify pizza                                        | src/views/delivery.tsx — Delivery (verify)              |  |  |
| View profile page                                   | src/views/dinerDashboard.tsx — DinerDashboard           | GET /api/user/me | SELECT: auth |
| View franchise<br/>(as diner)                       | src/views/franchiseDashboard.tsx — FranchiseDashboard   | GET /api/franchise | SELECT: franchise, store |
| Logout                                              | src/views/logout.tsx — Logout                           | DELETE /api/auth | DELETE: auth |
| View About page                                     | src/views/about.tsx — About                             |  |  |
| View History page                                   | src/views/history.tsx — History                         | GET /api/order | SELECT: auth, dinerOrder, orderItem |
| Login as franchisee<br/>(f@jwt.com, pw: franchisee) | src/views/login.tsx — Login                             | PUT /api/auth | SELECT: user, userRole; INSERT: auth |
| View franchise<br/>(as franchisee)                  | src/views/franchiseDashboard.tsx — FranchiseDashboard   | GET /api/franchise/:userId | SELECT: auth, userRole, franchise, store, dinerOrder, orderItem, user |
| Create a store                                      | src/views/createStore.tsx — CreateStore                 | POST /api/franchise/:franchiseId/store | SELECT: auth, userRole, user, store, dinerOrder, orderItem; INSERT: store |
| Close a store                                       | src/views/closeStore.tsx — CloseStore                   | DELETE /api/franchise/:franchiseId/store/:storeId | SELECT: auth, userRole, user, store, dinerOrder, orderItem; DELETE: store |
| Login as admin<br/>(a@jwt.com, pw: admin)           | src/views/login.tsx — Login                             | PUT /api/auth | SELECT: user, userRole; INSERT: auth |
| View Admin page                                     | src/views/adminDashboard.tsx — AdminDashboard           | GET /api/franchise | GET /api/order/menu<br/>(optional) PUT /api/order/menu | SELECT: franchise, store, dinerOrder, orderItem, user, menu; INSERT: menu |
| Create a franchise for t@jwt.com                    | src/views/createFranchise.tsx — CreateFranchise         | POST /api/franchise | SELECT: auth, user; INSERT: franchise, userRole |
| Close the franchise for t@jwt.com                   | src/views/closeFranchise.tsx — CloseFranchise           | DELETE /api/franchise/:franchiseId | DELETE: store, userRole, franchise |
