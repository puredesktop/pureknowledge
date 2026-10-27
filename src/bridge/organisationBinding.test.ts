import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn(),storage:vi.fn(),list:vi.fn()}))
vi.mock('@purescience/platform-ui/bridge/client',()=>({bridge:{call:mocks.call}}))
vi.mock('@purescience/platform-ui/bridge/storage',()=>({readPlatformStorageJson:mocks.storage}))
vi.mock('@purescience/platform-ui/bridge/fs',()=>({listPlatformFiles:mocks.list,readPlatformFileBinary:vi.fn(),writePlatformFileBinary:vi.fn()}))
import {fetchOrganisationBinding} from './platformBridge'
beforeEach(()=>{vi.resetAllMocks();mocks.storage.mockResolvedValue({path:'/one/.appdata/knowledge.json'})})
it('derives organisation identity only from this host workspace',async()=>{
 mocks.call.mockResolvedValue('---\nid: one\n---\nOrg')
 expect(await fetchOrganisationBinding()).toEqual({id:'one',folder:'/one'})
 expect(mocks.call).toHaveBeenCalledWith('fs.read',['/one/.appdata/executive/org.md'])
})
it('only a confirmed missing organisation marker permits personal mode',async()=>{
 mocks.call.mockRejectedValue(Error('unavailable'))
 mocks.list.mockResolvedValue({entries:[]})
 expect(await fetchOrganisationBinding()).toBeNull()
 mocks.list.mockRejectedValue(Error('access denied'))
 await expect(fetchOrganisationBinding()).rejects.toThrow('access denied')
})
it('refuses malformed identity and transport failures rather than opening a default library',async()=>{
 mocks.call.mockResolvedValue('---\nid: ../../other\n---')
 await expect(fetchOrganisationBinding()).rejects.toThrow('identity needs repair')
 mocks.call.mockRejectedValue(Error('read denied'))
 mocks.list.mockResolvedValueOnce({entries:[{name:'executive'}]}).mockResolvedValueOnce({entries:[{name:'org.md'}]})
 await expect(fetchOrganisationBinding()).rejects.toThrow('read denied')
})
