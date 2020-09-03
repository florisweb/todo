


const LocalDB = new function() {
  const DBName = "veratioDB";
  let DBVersion = 2;

  let DB; getDB();

  function getDB() {
    const request = indexedDB.open(DBName, DBVersion);

    request.onupgradeneeded = function(_e) { // create object stores
      DB = _e.target.result;

      const metaData          = DB.createObjectStore("metaData");
      const tasks             = DB.createObjectStore("tasks");
      const users             = DB.createObjectStore("users");
      const tags              = DB.createObjectStore("tags");
      const cachedOperations  = DB.createObjectStore("cachedOperations");
    }

    request.onsuccess = function(_e) {
      DB = _e.target.result;
    }

    request.onerror = function(_e) {
      console.warn("error", _e);
      indexedDB.deleteDatabase("veratioDB");
    }
  }



  this.getProjectList = async function(_ignoreUserAbsence = false) {
    let ids = await this.getProjectIdList();

    let projectList = [];
    for (let i = 0; i < ids.length; i++)
    {
      let project = new LocalDB_Project(ids[i], DB);
      await project.setMetaData();
      
      if (!project.users.Self && !_ignoreUserAbsence) continue; // project.remove(); -- should remove after some time, but we still need to keep it around for storing the cachedoperation of removing oneself

      projectList.push(project);
    }

    return projectList;
  }


  this.getProject = async function(_id, _ignoreUserAbsence = false) {
    let projectList = await this.getProjectList(_ignoreUserAbsence);
    for (let i = 0; i < projectList.length; i++)
    {
      if (projectList[i].id != _id) continue;
      return projectList[i];
    }
    return false;
  }


  this.updateProjectList = async function(_newList) {
    let invalidProjects = await this.getProjectList();

    for (let i = 0; i < _newList.length; i++)
    {
      let index = invalidProjects.findIndex(function (v) {return v.id == _newList[i].id});
      if (index != -1) invalidProjects.splice(index, 1);

      let project = await this.getProject(_newList[i].id);
      if (project) continue;
      this.addProject(_newList[i].id, _newList[i].title);
    }

    for (project of invalidProjects) project.remove();
  }

  



  this.addProject = async function(_id, _title = "A nameless project") {
    let project = new LocalDB_Project(_id, DB);
    await project.setData("metaData", {title: _title});

    return project;
  }


  this.removeProject = async function(_id) {
    let project = await this.getProject(_id);
    if (!project) return false;
    return await project.remove();
  }


  this.sendCachedOperations = async function() {
    let projects = await this.getProjectList();
    let promises = [];
    for (project of projects) promises.push(project.sendCachedOperations());

    return await Promise.all(promises); 
  }


  this.getProjectIdList = function() {
    return new Promise(function (resolve, error) {
      let store = DB.transaction("metaData", "readonly").objectStore("metaData");

      let ids = [];
      store.getAll().onsuccess = function(_e) {
        if (!_e.target.result) return error();

        resolve(
          _e.target.result.map(function (_item) {return _item.id})
        );
      };
    });
  }
}






function LocalDB_Project(_projectId, _DB) {
  let This = this;
  LocalDB_ProjectInterface.call(this, _projectId, _DB);
 

  this.title = "Loading..";

  this.sendCachedOperations = async function() {
    let operations = await this.getData("cachedOperations");
    
    let results = await Server.fetchFunctionRequestList(operations);
    console.log("Upload CO:", operations, results);


    let newOperations = await this.getData("cachedOperations");
    newOperations.splice(0, operations.length);
    this.setData("cachedOperations", newOperations);
  }



  this.setMetaData = async function() {
    let users = await this.users.getAll();
    for (let i = 0; i < users.length; i++)
    {
      if (!users[i].Self) continue;
      this.users.Self = users[i];
      break;
    }

    let metaData = await this.getData("metaData");
    this.title = metaData.title;
  }

  this.remove = async function() {
    let result = await Promise.all([
      this.removeData("metaData"),
      this.removeData("tasks"),
      this.removeData("users"),
      this.removeData("tags")
    ]);

    return result[0] && result[1] && result[2] && result[3];
  }

  this.rename = async function(_newTitle) {
    let data = await this.getData("metaData");
    data.title = _newTitle;
    return await this.setData("metaData", data);
  }




  this.tasks = new function() {
    const Key = "tasks";
    TypeBaseClass.call(this, Key);

   
    this.getByDateRange = async function({date, range}) {
      let tasks = await this.getAll();
      let response = {};
      date = new Date().setDateFromStr(date);

      for (let i = 0; i < tasks.length; i++)
      {
        if (tasks[i].groupType != "date") continue;
        let taskDate = new Date().setDateFromStr(tasks[i].groupValue);
        if (!taskDate || !taskDate.dateIsBetween(date, date.copy().moveDay(range))) continue;
        
        if (typeof response[tasks[i].groupValue] != "object") response[tasks[i].groupValue] = [];
        response[tasks[i].groupValue].push(tasks[i]);
      }

      return response;
    }

    this.getByGroup = async function({type, value = "*"}) {
      let tasks = await this.getAll();
      let response = [];
      
      for (let i = 0; i < tasks.length; i++)
      {
        if (tasks[i].groupType != type) continue;
        if (value != "*" && tasks[i].groupValue != value) continue;
        
        response.push(tasks[i]);
      }
      return response;
    }
  }


  this.tags = new function() {
    const Key = "tags";
    TypeBaseClass.call(this, Key);
  }

  this.users = new function() {
    const Key = "users";
    TypeBaseClass.call(this, Key);

    this.Self = false;
  }








  function TypeBaseClass(_key) {
    let Key = _key;

    this.update = async function(_newItem) {
      let data = await this.getAll();
      let found = false;

      for (let i = 0; i < data.length; i++)
      {
        if (data[i].id != _newItem.id) continue;
        data[i] = _newItem;
        found = true;
      }

      if (!found) data.push(_newItem);

      return This.setData(Key, data);
    }


    this.get = async function(_id) {
      let items = await this.getAll();
    
      for (let i = 0; i < items.length; i++)
      {
        if (items[i].id != _id) continue;
        return items[i];
      }
      return false;
    }


    this.remove = async function(_id) {
      let items = await this.getAll();
      
      for (let i = 0; i < items.length; i++)
      {
        if (items[i].id != _id) continue;
        items.splice(i, 1);
        
        return await This.setData(Key, items);
      }
      return false;
    }

    this.removeAll = async function() {
      return This.setData(Key, []);
    }

    this.set = async function(_data) {
      return await This.setData(Key, _data);
    }


    this.getAll = async function() {
      let items = await This.getData(Key);
      if (!items) return [];
      return items;
    }
  }
}






function LocalDB_ProjectInterface(_projectId, _DB) {
  let This = this;
  let DB = _DB;
  this.id = _projectId;


  this.getData = function(_key) {
    return new Promise(function (resolve, error) {
      let store = DB.transaction(_key, "readonly").objectStore(_key);
      let request = store.get(This.id);
      
      request.onsuccess = function(_e) {
        let data = request.result;
        if (typeof data != "object") data = [];
        resolve(data);
      }
    });
  }

  this.setData = function(_key, _value) {
    return new Promise(function (resolve, error) {
      const transaction = DB.transaction(_key, "readwrite");
      transaction.onerror = error;
      const store = transaction.objectStore(_key);

      _value.id = This.id;
      let trans2 = store.put(JSON.parse(JSON.stringify(_value)), This.id);
      resolve();//TODO actual success-checking
    });
  }


  this.removeData = function(_key) {
    return new Promise(function (resolve, error) {
      const transaction = DB.transaction(_key, "readwrite");
      transaction.onerror = error;

      const store = transaction.objectStore(_key);

      let request = store.delete(This.id);
      request.onerror = error;
      request.onsuccess = function(event) {
        resolve(true);
      }
    });
  }


  this.addCachedOperation = async function(_operation) {
    let data = await this.getData("cachedOperations");
    if (!data) data = [];
    data.push(_operation);

    return await this.setData("cachedOperations", data);
  }
}
