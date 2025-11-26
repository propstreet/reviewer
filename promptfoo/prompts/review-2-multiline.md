# mock PR - Multi-line comment test

## COMMIT SHA: abc123def456

### src/userService.ts

```diff
@@ -1,8 +1,25 @@
 export class UserService {
     private users: any[] = [];

+    // TODO: Add proper error handling
+    async createUser(data: any) {
+        console.log("Creating user:", data);
+        console.log("Password:", data.password);
+        const user = {
+            id: Math.random(),
+            ...data,
+            password: data.password
+        };
+        this.users.push(user);
+        return user;
+    }
+
     getUser(id: number) {
         return this.users.find(u => u.id === id);
     }
 }
```
