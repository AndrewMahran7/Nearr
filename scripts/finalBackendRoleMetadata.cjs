/** Export non-secret role definitions for isolated local restoration only. */
const {sql,targets,output,save}=require('./finalBackendReadiness.cjs');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const roles=sql(targets.production,"select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname not like 'pg_%' and rolname not like 'cli_login_%' order by rolname");
const memberships=sql(targets.production,"select r.rolname as role_name,m.rolname as member_name,a.admin_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname not like 'cli_login_%' and m.rolname not like 'cli_login_%' order by r.rolname,m.rolname");
writeFileSync(join(output,'.tmp/private-production-backup/roles-metadata.json'),JSON.stringify({roles,memberships},null,2));
save('role-metadata-receipt.json',{capturedAt:new Date().toISOString(),roleCount:roles.length,membershipCount:memberships.length,passwordsExported:false,ephemeralCliRolesExcluded:true,remoteMutation:false});
console.log(JSON.stringify({roleCount:roles.length,membershipCount:memberships.length,passwordsExported:false}));
