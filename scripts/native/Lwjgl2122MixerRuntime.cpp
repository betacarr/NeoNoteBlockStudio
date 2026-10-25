// PREPARATION ONLY: never loaded by the prepare command. Win64, exact reviewed binary only.
// A successful future pilot observes this process's zero-source regular render packets.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <jni.h>
#include <intrin.h>
#include <stddef.h>
#include <string.h>
using u8=unsigned char;using u32=unsigned int;using u64=unsigned __int64;using i64=__int64;
#pragma function(memset)
extern "C" void* __cdecl memset(void* target,int value,size_t bytes){__stosb((u8*)target,(u8)value,bytes);return target;}
using Mixer=void(__cdecl*)(void*,void*,int);
struct Control{Mixer original;void* device;u8* slots;u64 capacity,stride,maxFrames;volatile i64 armed,inflight,calls,attempted,committed,dropped,invalid;};
struct Slot{volatile i64 publish;u64 sequence,device,buffer;u32 frames,frequency,formatChannels,formatType,updateSize,numUpdates;u64 bytes;};
static_assert(sizeof(Control)==104&&sizeof(Slot)==64&&sizeof(void*)==8,"Frozen observer ABI");
static_assert(offsetof(Control,armed)==48&&offsetof(Control,invalid)==96&&offsetof(Slot,bytes)==56,"Frozen offsets");
constexpr u64 CAPACITY=256,RESERVE_FRAMES=16384,STRIDE=64+RESERVE_FRAMES*8+64,TEXT_RVA=0x1000,TEXT_VIRTUAL_SIZE=231284,TEXT_SIZE=231424;
constexpr u64 SITE_RVA=0x202c8,MIXER_RVA=0x157e8,WORKER_RVA=0x20198,IMAGE_SIZE=409600;
static const u8 originalHash[32]={0x92,0x61,0xb6,0x60,0x10,0xa8,0x45,0xdd,0xef,0x9f,0x61,0xd5,0xe4,0x26,0x6f,0xe2,0xf0,0x8a,0x53,0xf3,0x60,0x5d,0xa0,0x02,0xe9,0xe8,0xf8,0xd2,0x02,0xbd,0xbc,0x5e};
static u64 state[64]; // Named, fixed schema in the Java driver and preparation report.
struct List{u32 count,status,failed,error;u32 words[257];};static List lists[4];
static u32 declared[7];static u64 base,pointer,outputWords[64+13+4*(4+257)],finalCounters[7];static i64 original8,patched8;static DWORD siteProtection;
static HMODULE originalModule,observerModule;static HANDLE duplicateWorker;
static u8 *expectedText,*baseline,*island;static void *controlReservation,*slabReservation;
static Control* control;static u8* slab;static SIZE_T pageSize;static wchar_t observerPath[32768],modulePath[32768],loadedPath[32768];static u8 observerHash[32];
static bool configured,installed,restored,released;
static void copy(void* to,const void* from,u64 bytes){__movsb((u8*)to,(const u8*)from,bytes);}
static bool same(const void* x,const void* y,u64 n){const u8*a=(const u8*)x,*b=(const u8*)y;for(u64 i=0;i<n;i++)if(a[i]!=b[i])return false;return true;}
static bool fail(u64 code){if(!state[0]){state[0]=code;state[1]=GetLastError();}return false;}
static bool read(void* address,void* out,SIZE_T bytes){SIZE_T n=0;return ReadProcessMemory(GetCurrentProcess(),address,out,bytes,&n)&&n==bytes;}
static u64 live(volatile i64* p){return(u64)_InterlockedCompareExchange64(p,0,0);}
static void* guarded(SIZE_T n,void** reservation){SIZE_T rounded=(n+pageSize-1)&~(pageSize-1);void*p=VirtualAlloc(nullptr,rounded+2*pageSize,MEM_RESERVE,PAGE_NOACCESS);if(!p)return nullptr;*reservation=p;void*middle=(u8*)p+pageSize;if(VirtualAlloc(p,pageSize,MEM_COMMIT,PAGE_NOACCESS)!=p||VirtualAlloc((u8*)middle+rounded,pageSize,MEM_COMMIT,PAGE_NOACCESS)!=(u8*)middle+rounded||VirtualAlloc(middle,rounded,MEM_COMMIT,PAGE_READWRITE)!=middle)return nullptr;MEMORY_BASIC_INFORMATION a={},b={};if(!VirtualQuery(p,&a,sizeof(a))||!VirtualQuery((u8*)middle+rounded,&b,sizeof(b))||a.Protect!=PAGE_NOACCESS||b.Protect!=PAGE_NOACCESS)return nullptr;return middle;}
static bool hashFile(const wchar_t* file,const u8* expected){
 BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE h=nullptr;DWORD length=0,n=0,used=0;u8 digest[32];void*object=nullptr;u8*chunk=nullptr;HANDLE input=INVALID_HANDLE_VALUE;bool ok=false;
 if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)goto done;
 if(BCryptGetProperty(alg,BCRYPT_OBJECT_LENGTH,(PUCHAR)&length,sizeof(length),&used,0)<0||length>4096)goto done;
 object=VirtualAlloc(nullptr,length,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);chunk=(u8*)VirtualAlloc(nullptr,65536,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);if(!object||!chunk)goto done;
 if(BCryptCreateHash(alg,&h,(PUCHAR)object,length,nullptr,0,0)<0)goto done;
 input=CreateFileW(file,GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);if(input==INVALID_HANDLE_VALUE)goto done;
 for(;;){if(!ReadFile(input,chunk,65536,&n,nullptr))goto done;if(!n)break;if(BCryptHashData(h,chunk,n,0)<0)goto done;}
 if(BCryptFinishHash(h,digest,32,0)<0)goto done;ok=same(digest,expected,32);
done:if(input!=INVALID_HANDLE_VALUE)CloseHandle(input);if(h)BCryptDestroyHash(h);if(alg)BCryptCloseAlgorithmProvider(alg,0);if(object)VirtualFree(object,0,MEM_RELEASE);if(chunk)VirtualFree(chunk,0,MEM_RELEASE);return ok;
}
static bool textMatches(bool patched){u8*text=(u8*)originalModule+TEXT_RVA;for(u64 i=0;i<TEXT_SIZE;i++){u8 want=baseline[i];if(patched&&i>=SITE_RVA-TEXT_RVA&&i<SITE_RVA-TEXT_RVA+5)want=((u8*)&patched8)[i-(SITE_RVA-TEXT_RVA)];u8 value;if(!read(text+i,&value,1)||value!=want)return false;}return true;}
static void snapshot(u64 address,List& list){list.count=0;list.status=0;list.failed=0xffffffff;list.error=0;if(!address){list.status=4;return;}for(u32 i=0;i<257;i++){u32 word;if(!read((void*)(address+4ull*i),&word,4)){list.status=3;list.failed=i;list.error=GetLastError();return;}list.words[i]=word;list.count=i+1;if(!(i&1)&&!word){list.status=1;return;}}list.status=2;}
static bool stable(const List&a,const List&b){return a.status==1&&b.status==1&&a.count==b.count&&same(a.words,b.words,a.count*4);}
static bool samePath(const wchar_t*a,const wchar_t*b){for(u32 i=0;i<32768;i++){wchar_t x=a[i],y=b[i];if(x=='/')x='\\';if(y=='/')y='\\';if(x>='A'&&x<='Z')x+=32;if(y>='A'&&y<='Z')y+=32;if(x!=y)return false;if(!x)return true;}return false;}
static bool pin(void*address,HMODULE*module){return GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,(LPCWSTR)address,module)!=0;}
static bool install(){
 state[2]=1;originalModule=GetModuleHandleW(L"OpenAL64.dll");if(!originalModule)return fail(10);state[3]=(u64)originalModule;
 DWORD pathLength=GetModuleFileNameW(originalModule,modulePath,32768);if(!pathLength||pathLength>=32768||!hashFile(modulePath,originalHash))return fail(11);state[4]=1;
 HMODULE held=nullptr;if(!pin(originalModule,&held)||held!=originalModule)return fail(12);state[5]=1;if(!pin((void*)&install,&held))return fail(13);state[6]=1;
 IMAGE_DOS_HEADER dos={};IMAGE_NT_HEADERS64 pe={};if(!read(originalModule,&dos,sizeof(dos))||dos.e_magic!=IMAGE_DOS_SIGNATURE||dos.e_lfanew<0||dos.e_lfanew>4096||!read((u8*)originalModule+dos.e_lfanew,&pe,sizeof(pe))||pe.Signature!=IMAGE_NT_SIGNATURE||pe.FileHeader.Machine!=IMAGE_FILE_MACHINE_AMD64||pe.OptionalHeader.SizeOfImage!=IMAGE_SIZE)return fail(14);
 IMAGE_SECTION_HEADER section={};bool found=false;u8*sections=(u8*)originalModule+dos.e_lfanew+24+pe.FileHeader.SizeOfOptionalHeader;for(u32 i=0;i<pe.FileHeader.NumberOfSections;i++){if(!read(sections+i*sizeof(section),&section,sizeof(section)))return fail(15);if(same(section.Name,".text\0\0\0",8)){found=true;break;}}
 if(!found||section.VirtualAddress!=TEXT_RVA||section.Misc.VirtualSize!=TEXT_VIRTUAL_SIZE||section.SizeOfRawData!=TEXT_SIZE||!(section.Characteristics&IMAGE_SCN_MEM_EXECUTE))return fail(16);
 baseline=(u8*)VirtualAlloc(nullptr,TEXT_SIZE,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);if(!baseline||!read((u8*)originalModule+TEXT_RVA,baseline,TEXT_SIZE)||!same(baseline,expectedText,TEXT_SIZE))return fail(17);state[7]=1;
 using Current=void*(__cdecl*)();auto current=(Current)GetProcAddress(originalModule,"alcGetCurrentContext");if(!current||current()!=nullptr)return fail(18);state[8]=1;
 PROCESS_MITIGATION_DYNAMIC_CODE_POLICY policy={};if(!GetProcessMitigationPolicy(GetCurrentProcess(),ProcessDynamicCodePolicy,&policy,sizeof(policy))||policy.ProhibitDynamicCode)return fail(19);state[9]=policy.Flags;
 control=(Control*)guarded(sizeof(Control),&controlReservation);slab=(u8*)guarded(CAPACITY*STRIDE,&slabReservation);if(!control||!slab)return fail(20);state[10]=(u64)control;state[11]=(u64)slab;state[12]=CAPACITY;state[13]=STRIDE;state[14]=RESERVE_FRAMES;
 control->original=(Mixer)((u8*)originalModule+MIXER_RVA);control->slots=slab;control->capacity=CAPACITY;control->stride=STRIDE;control->maxFrames=RESERVE_FRAMES;
 for(u64 i=0;i<CAPACITY;i++)for(u64 j=64+RESERVE_FRAMES*8;j<STRIDE;j++)slab[i*STRIDE+j]=0xa5;state[15]=1;
 observerModule=LoadLibraryExW(observerPath,nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);if(!observerModule)return fail(21);if(!GetModuleFileNameW(observerModule,loadedPath,32768)||!samePath(loadedPath,observerPath)||!hashFile(loadedPath,observerHash))return fail(22);
 auto observer=GetProcAddress(observerModule,"Observer");auto bind=(u64(__cdecl*)(Control*))GetProcAddress(observerModule,"ObserverBind");if(!observer||!bind||!pin((void*)observer,&held)||held!=observerModule)return fail(23);state[16]=(u64)observerModule;state[17]=(u64)observer;if(bind(control)!=((104ull<<32)|64))return fail(24);state[18]=1;
 u8*site=(u8*)originalModule+SITE_RVA;state[19]=(u64)site;if(((u64)site&7)||((u64)site/pageSize!=((u64)site+7)/pageSize)||SITE_RVA+8>TEXT_RVA+TEXT_SIZE)return fail(25);state[20]=1;
 MEMORY_BASIC_INFORMATION code={};if(!VirtualQuery(site,&code,sizeof(code))||code.State!=MEM_COMMIT||code.AllocationBase!=originalModule||!(code.Protect&(PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY)))return fail(26);
 if(!read(site,&original8,8)||!same(&original8,"\xe8\x1b\x55\xff\xff",5))return fail(27);patched8=original8;
 for(u64 delta=0;delta<0x7fff0000ull&&!island;delta+=65536){for(u32 direction=0;direction<2&&!island;direction++){u64 aligned=(u64)site&~65535ull;if(direction&&delta>aligned-65536)continue;u64 at=direction?aligned-delta:aligned+delta;i64 rel=(i64)at-(i64)((u64)site+5);if(at<65536||rel<(-2147483647ll-1)||rel>2147483647ll)continue;island=(u8*)VirtualAlloc((void*)at,pageSize,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);if(island&&(u64)island!=at)return fail(28);}}
 if(!island)return fail(29);state[21]=(u64)island;island[0]=0x48;island[1]=0xb8;copy(island+2,&observer,8);island[10]=0xff;island[11]=0xe0;DWORD previous=0;if(!VirtualProtect(island,pageSize,PAGE_EXECUTE_READ,&previous)||!FlushInstructionCache(GetCurrentProcess(),island,12))return fail(30);
 u8 expect[12]={0x48,0xb8};copy(expect+2,&observer,8);expect[10]=0xff;expect[11]=0xe0;u8 actual[12];if(!read(island,actual,12)||!same(actual,expect,12))return fail(31);state[22]=1;
 i64 distance=(i64)island-(i64)(site+5);u32 rel=(u32)(i64)distance;((u8*)&patched8)[0]=0xe8;copy((u8*)&patched8+1,&rel,4);if(!same((u8*)&original8+5,(u8*)&patched8+5,3))return fail(32);
 state[23]=(u64)original8;state[24]=(u64)patched8;if(live(&control->calls)||live(&control->inflight))return fail(33);
 if(!VirtualProtect(site,8,PAGE_EXECUTE_READWRITE,&siteProtection))return fail(34);state[25]=siteProtection;
 i64 replaced=_InterlockedCompareExchange64((volatile i64*)site,patched8,original8);installed=replaced==original8;state[26]=installed?1:0;DWORD ignored=0;bool protectedAgain=VirtualProtect(site,8,siteProtection,&ignored)!=0;bool flushed=FlushInstructionCache(GetCurrentProcess(),site,8)!=0;
 if(!installed||!protectedAgain||!flushed)return fail(35);i64 seen=0;if(!read(site,&seen,8)||seen!=patched8||!textMatches(true))return fail(36);state[27]=1;return true;
}
static bool arm(u64 context){
 if(state[0]||!installed||!context||context!=state[32]||!stable(lists[0],lists[1])||!stable(lists[2],lists[3])||!stable(lists[0],lists[2]))return fail(40);
 using Device=void*(__cdecl*)(void*);using Current=void*(__cdecl*)();auto deviceOf=(Device)GetProcAddress(originalModule,"alcGetContextsDevice");auto current=(Current)GetProcAddress(originalModule,"alcGetCurrentContext");if(!deviceOf||!current||current()!=(void*)context)return fail(41);u64 device=(u64)deviceOf((void*)context);state[33]=device;u32 fields[5]={};if(!device||!read((void*)(device+0x38),fields,sizeof(fields))||fields[0]!=48000||fields[3]!=5377||fields[4]!=5126||!fields[1]||fields[1]>4096||!fields[2]||fields[2]>16||(u64)fields[1]*fields[2]>RESERVE_FRAMES)return fail(42);
 state[34]=fields[0];state[35]=fields[1];state[36]=fields[2];state[37]=fields[3];state[38]=fields[4];
 u64 extra=0,thread=0,obj[3]={},again[3]={};if(!read((void*)(device+0x16200),&extra,8)||!extra||!read((void*)(extra+0x38),&thread,8)||!thread||!read((void*)thread,obj,24)||!read((void*)thread,again,24)||!same(obj,again,24)||obj[0]!=(u64)originalModule+WORKER_RVA||obj[1]!=device||!obj[2])return fail(43);
 state[39]=extra;state[40]=thread;state[41]=obj[0];state[42]=obj[1];state[43]=obj[2];if(!DuplicateHandle(GetCurrentProcess(),(HANDLE)obj[2],GetCurrentProcess(),&duplicateWorker,0,FALSE,DUPLICATE_SAME_ACCESS))return fail(44);
 state[44]=(u64)duplicateWorker;state[45]=GetProcessIdOfThread(duplicateWorker);state[46]=GetThreadId(duplicateWorker);DWORD exit=0;state[47]=WaitForSingleObject(duplicateWorker,0);if(state[45]!=GetCurrentProcessId()||!state[46]||state[47]!=WAIT_TIMEOUT||!GetExitCodeThread(duplicateWorker,&exit)||exit!=STILL_ACTIVE)return fail(45);state[48]=exit;
 control->device=(void*)device;control->maxFrames=(u64)fields[1]*fields[2];state[49]=control->maxFrames;_InterlockedExchange64(&control->armed,1);state[50]=1;return true;
}
static bool finish(){
 if(state[0]||!installed||!duplicateWorker||!control||live(&control->armed))return fail(50);
 state[51]=WaitForSingleObject(duplicateWorker,0);state[52]=live(&control->inflight);if(state[51]!=WAIT_OBJECT_0||state[52])return fail(51);
 using Current=void*(__cdecl*)();auto current=(Current)GetProcAddress(originalModule,"alcGetCurrentContext");if(!current||current()!=nullptr)return fail(52);state[53]=1;
 if(live(&control->dropped)||live(&control->invalid)||live(&control->attempted)!=live(&control->committed)||!live(&control->committed))return fail(53);
 for(u64 i=0;i<CAPACITY;i++)for(u64 j=64+RESERVE_FRAMES*8;j<STRIDE;j++)if(slab[i*STRIDE+j]!=0xa5)return fail(54);state[54]=1;
 if(!textMatches(true))return fail(55);u8*site=(u8*)originalModule+SITE_RVA;DWORD old=0;if(!VirtualProtect(site,8,PAGE_EXECUTE_READWRITE,&old))return fail(56);state[55]=old;
 i64 seen=_InterlockedCompareExchange64((volatile i64*)site,original8,patched8);DWORD ignored=0;bool protection=VirtualProtect(site,8,old,&ignored)!=0,flushed=FlushInstructionCache(GetCurrentProcess(),site,8)!=0;if(seen!=patched8||!protection||!flushed)return fail(57);
 installed=false;state[56]=1;i64 actual=0;if(!read(site,&actual,8)||actual!=original8||!textMatches(false))return fail(58);restored=true;state[57]=1;return true;
}
static void throwSetup(JNIEnv*env){jclass error=env->FindClass("java/lang/IllegalStateException");if(error)env->ThrowNew(error,"Mixer setup gate failed: original JNI context creation was not executed; allocations remain pinned");}
extern "C" JNIEXPORT void JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_configure(JNIEnv*env,jclass,jbyteArray text,jstring observer,jbyteArray digest){
 if(configured||env->GetArrayLength(text)!=(jsize)TEXT_SIZE||env->GetArrayLength(digest)!=32){fail(1);throwSetup(env);return;}SYSTEM_INFO sys={};GetSystemInfo(&sys);pageSize=sys.dwPageSize;if(pageSize!=4096||sys.dwAllocationGranularity!=65536){fail(2);throwSetup(env);return;}
 expectedText=(u8*)VirtualAlloc(nullptr,TEXT_SIZE,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);if(!expectedText){fail(3);throwSetup(env);return;}env->GetByteArrayRegion(text,0,(jsize)TEXT_SIZE,(jbyte*)expectedText);env->GetByteArrayRegion(digest,0,32,(jbyte*)observerHash);jsize n=env->GetStringLength(observer);if(n<1||n>=32768){fail(4);throwSetup(env);return;}env->GetStringRegion(observer,0,n,(jchar*)observerPath);observerPath[n]=0;configured=true;
}
extern "C" JNIEXPORT void JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_bufferEntry(JNIEnv*env,jclass,jlong address,jint pos,jint lim,jint cap,jintArray words){
 state[28]++;base=(u64)address;state[29]=base;state[30]=pos;state[31]=lim;if(!configured||state[28]!=1||pos!=7||lim!=7||cap!=7||env->GetArrayLength(words)!=7){fail(5);throwSetup(env);return;}env->GetIntArrayRegion(words,0,7,(jint*)declared);const u32 expected[7]={4103,44100,4104,60,4105,0,0};if(!same(declared,expected,28)){fail(6);throwSetup(env);}
}
extern "C" JNIEXPORT void JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_beforeNative(JNIEnv*env,jclass,jlong address){
 pointer=(u64)address;state[58]=pointer;if(state[0]||!configured||state[28]!=1||state[59]||state[60]||installed||pointer!=base+28){fail(9);throwSetup(env);return;}if(!install()){throwSetup(env);return;}snapshot(pointer,lists[0]);snapshot(pointer,lists[1]);if(!stable(lists[0],lists[1])){fail(7);throwSetup(env);return;}state[59]=1;
 // No allocation, file I/O, JNI call or throwing path follows the final native-list reads on success.
}
extern "C" JNIEXPORT void JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_afterNative(JNIEnv*,jclass,jlong context){
 state[32]=(u64)context;snapshot(pointer,lists[2]);snapshot(pointer,lists[3]);if(!context||!stable(lists[2],lists[3])||!stable(lists[0],lists[2]))fail(8);state[60]=1;
 // Never throw here: allow original ALC10 wrapper/AL.init to register and clean its actual context normally.
}
extern "C" JNIEXPORT jboolean JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_arm(JNIEnv*,jclass,jlong context){return arm((u64)context)?JNI_TRUE:JNI_FALSE;}
extern "C" JNIEXPORT void JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_disarm(JNIEnv*,jclass){if(control)_InterlockedExchange64(&control->armed,0);}
extern "C" JNIEXPORT jboolean JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_finish(JNIEnv*,jclass){return finish()?JNI_TRUE:JNI_FALSE;}
extern "C" JNIEXPORT jlongArray JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_state(JNIEnv*env,jclass){
 u64*out=outputWords;__stosb((u8*)out,0,sizeof(outputWords));copy(out,state,sizeof(state));out[64]=(u64)base;out[65]=pointer;out[66]=installed;out[67]=restored;out[68]=released;if(control){out[69]=live(&control->armed);out[70]=live(&control->inflight);out[71]=live(&control->calls);out[72]=live(&control->attempted);out[73]=live(&control->committed);out[74]=live(&control->dropped);out[75]=live(&control->invalid);}else copy(out+69,finalCounters,sizeof(finalCounters));out[76]=GetCurrentProcessId();u64 at=77;for(u32 i=0;i<4;i++){out[at++]=lists[i].count;out[at++]=lists[i].status;out[at++]=lists[i].failed;out[at++]=lists[i].error;for(u32 j=0;j<257;j++)out[at++]=lists[i].words[j];}jlongArray a=env->NewLongArray((jsize)at);if(a)env->SetLongArrayRegion(a,0,(jsize)at,(const jlong*)out);return a;
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_slot(JNIEnv*env,jclass,jint index){
 if(!restored||released||!control||index<0||(u64)index>=live(&control->committed))return nullptr;Slot*s=(Slot*)(slab+(u64)index*STRIDE);u64 bytes=s->bytes,buffer=s->buffer;if(live(&s->publish)!=(u64)index+1||s->sequence!=(u64)index||s->device!=(u64)control->device||!bytes||bytes!=(u64)s->frames*8||bytes>control->maxFrames*8||bytes>STRIDE-64||s->frequency!=48000||s->formatChannels!=5377||s->formatType!=5126||!s->updateSize||s->updateSize!=state[35]||s->numUpdates!=state[36]||s->frames%s->updateSize||buffer+bytes<buffer||(buffer<(u64)slab+CAPACITY*STRIDE&&buffer+bytes>(u64)slab)){fail(60);return nullptr;}jbyteArray a=env->NewByteArray((jsize)(64+bytes));if(a)env->SetByteArrayRegion(a,0,(jsize)(64+bytes),(jbyte*)s);return a;
}
extern "C" JNIEXPORT jboolean JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_release(JNIEnv*,jclass){
 if(state[0]||!restored||released||!control||live(&control->inflight)||!duplicateWorker||WaitForSingleObject(duplicateWorker,0)!=WAIT_OBJECT_0)return JNI_FALSE;
 finalCounters[0]=live(&control->armed);finalCounters[1]=live(&control->inflight);finalCounters[2]=live(&control->calls);finalCounters[3]=live(&control->attempted);finalCounters[4]=live(&control->committed);finalCounters[5]=live(&control->dropped);finalCounters[6]=live(&control->invalid);
 // No callback can reach observer memory after joined worker + restored/verified text.
 if(!CloseHandle(duplicateWorker))return fail(61)?JNI_TRUE:JNI_FALSE;duplicateWorker=nullptr;
 bool ok=VirtualFree(slabReservation,0,MEM_RELEASE)!=0;if(ok){slab=nullptr;slabReservation=nullptr;}else return fail(62)?JNI_TRUE:JNI_FALSE;
 if(!VirtualFree(controlReservation,0,MEM_RELEASE))return fail(63)?JNI_TRUE:JNI_FALSE;control=nullptr;controlReservation=nullptr;
 if(!VirtualFree(island,0,MEM_RELEASE))return fail(64)?JNI_TRUE:JNI_FALSE;island=nullptr;
 if(!VirtualFree(baseline,0,MEM_RELEASE))return fail(65)?JNI_TRUE:JNI_FALSE;baseline=nullptr;
 if(!VirtualFree(expectedText,0,MEM_RELEASE))return fail(66)?JNI_TRUE:JNI_FALSE;expectedText=nullptr;released=true;state[61]=1;return JNI_TRUE;
 // Original/observer/controller modules are intentionally PINned until process terminal, including success.
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_text(JNIEnv*env,jclass,jboolean mapped){
 if(!baseline||released)return nullptr;u8*source=mapped?(u8*)originalModule+TEXT_RVA:baseline;jbyteArray a=env->NewByteArray((jsize)TEXT_SIZE);if(a)env->SetByteArrayRegion(a,0,(jsize)TEXT_SIZE,(const jbyte*)source);return a;
}
extern "C" JNIEXPORT jstring JNICALL Java_studio_nbsx_research_Lwjgl2122MixerRuntime_modulePath(JNIEnv*env,jclass,jstring name){
 wchar_t key[256];jsize n=env->GetStringLength(name);if(n<1||n>=256)return nullptr;env->GetStringRegion(name,0,n,(jchar*)key);key[n]=0;HMODULE module=GetModuleHandleW(key);if(!module)return nullptr;DWORD length=GetModuleFileNameW(module,loadedPath,32768);if(!length||length>=32768)return nullptr;return env->NewString((jchar*)loadedPath,(jsize)length);
}
