
youtube  downloading  method  
----------------------------------------------------
**

# yt-dlp \

#   -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \

#   --yes-playlist \

#   --merge-output-format mp4 \

#   --concurrent-fragments 16 \

#   -o "%(playlist_index)03d - %(title)s.%(ext)s" \

#   "https://www.youtube.com/watch?v=-5kJH3cRURA&list=RD-5kJH3cRURA"

**

rsync command samples 
-----------------------------------------------
**

rsync -aW --no-compress --info=progress2 \

--remove-source-files --inplace \

--whole-file \

"Watch Limitless Online HD"* \

/home/shashi/media-server/downloads/movies/english/

**

mail test config 
---------------------------

**  


echo "Test from Rocky" | mailx -v -n \

-s "Zoho Test" \

-S mta=smtps://smtp.zoho.com:465 \

-S smtp-auth=login \

-S smtp-auth-user=support@linuxconsulting.my \

-S smtp-auth-password='Oracle@power22' \

-S from="support@linuxconsulting.my" \

support@linuxconsulting.my

**
my tailscale configuration 
---------------------------------------------

**sudo systemctl start tailscaled && sudo tailscale up --reset --force-reauth --accept-dns=false --accept-routes=true**

**

netstat commands
--------------------------------

  

 netstat -ntu | awk ' $5 ~ /^(::ffff:|[0-9|])/ { gsub("::ffff:","",$5); print $5}' | cut -d: -f1 | sort | uniq -c | sort -nr

ps -eo comm

mount /tmp folder with exec option

**

**

## Disk space checks 

du / -xh --max-depth=1

sudo du /home -xh --max-depth=1 | grep G | sort -rn | head

du -cha --max-depth=1 / | grep -E "M|G"disk

sudo du -h --max-depth=2 |sort -n -r

sudo du -h --max-depth=1

du -sh /var/lib/mysql/* | sort -h

sudo -s

  

for d in /*; do

  if ! findmnt -n -o FSTYPE --target "$d" | grep -q '^nfs'; then

    du -sh "$d" 2>/dev/null

  fi

done

  
  

du --max-depth=1 -h

du -Pshx --one-file-system /var/outsoc/* 2>/dev/null

  

du -Pshx --exclude=/var/outsoc/datastore /var/outsoc/* 2>/dev/null

Find deleted files that are still taking up space

[root@per5-eps-gwsscanevals cache]# lsof | grep deleted

  

du -xhS | sort -h | tail -n15

du -hs /*

du -hs /home/* | sort -rn | head -n 20

  

du -ahx / | grep -E '\d+G\s+'

du -sh *

du -Pshx /* 2>/dev/null

  

stat -c '%y %n' /var/ossec/queue/db/* | xargs -I{} sh -c 'echo "$(du -shx ${1#* } 2>/dev/null) ${1% *}"' _ {} | sort -hr

  

find /var/ossec/queue/db/* -printf "%T@ %s %p\n" | sort -hr | awk '{size=$2/1024; print size "MB", $3, strftime("%Y-%m-%d %H:%M:%S", $1)}'

  
  

find /var/ossec/queue/db/* -printf "%T@ %s %p\n" | sort -n | awk '{size=$2/1024; print size "MB", $3, strftime("%Y-%m-%d %H:%M:%S", $1)}'

  
  

du -ahx / | sort -rh | head -n 20

du -cshx /

exit

  

du -s -h /

du -ahx /var/cluster/daily/ | sort -rh | head -5

 du -sk /var/cluster/daily/* | sort -rn | head -3

du -hsxc /*

df -alhk | sort -nk2 # list disk usage and sort by used blocks

df -alhT | sort -hk3 # show and sort by human-readable usage

df --si | sort -hk3 # (this one doesn't show the empty file systems)

df --si | sort -nk5 # sort by percentage full

du -sh /var/outsoc/*

df -h -T   # show  partition type

df -h --output=source,fstype,size,used,avail,pcent,target -x tmpfs -x devtmpfs #show partition type 

Lsblk # list storage blocks:

Blkid # for block device attributes:

du -sch * | grep G  (from the directory u want to check)

find . -type f  -exec du -h {} + | sort -r -h

**

**

## Find Inodes 

sudo find . -xdev -type f | cut -d "/" -f 2 | sort | uniq -c | sort -n

echo "Detailed Inodes usage for: $(pwd)" ; for d in `find -maxdepth 1 -type d |cut -d\/ -f2 |grep -xv . |sort`; do c=$(find $d |wc -l) ; printf "$c\t\t- $d\n" ; done ; printf "Total: \t\t$(find $(pwd) | wc -l)\n"

for i in /*; do echo $i; find $i |wc -l; done

**

**

## Move commands

find . -maxdepth 1 -type f -name '*.gz' -exec mv {} /path/to/destination/ \;

find . -maxdepth 1 -type f -name '*.gz' -exec mv {} /tmp/ \;

find . -maxdepth 1 -type f -name '*.zip' -exec mv {} /tmp/ \;

## Mount Commands 

mount -o loop /root/<CentOS7 .iso> /mnt

  

## Screen Commands 

screen command

screen -ls

screen -S shashi

screen -x shashi 

screen -X -S 10675.tap3 kill

**


**

## Tar Commands

Tar high compression

export GZIP=-9

tar cvzf file.tar.gz /path/to/directory

tar c /path/to/data | gzip --best > file.tar.gz

gzip -d *

Tar and remove files 

for i in *; do tar -czf $i.tar.gz $i; rm -f $i; done

tar -xzvf by

  

## Check DDOS

netstat -ntu|awk '{print $5}'|cut -d: -f1 -s|sort|uniq -c|sort -nk1 -r

netstat -ntu | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -nr | head -3

netstat -n -p|grep SYN_REC | wc -l

Get  timeouts for domain

[svirasingam@emd1 smtad]$  zgrep -e "TIMEOUT" -e "LOST"  smtad.1206* | grep 'mailgun' | awk '{ print $10" "$11}' | sort | uniq -c | sort -nr | head -10

  

## Check runlevel 

chkconfig --list | grep $(runlevel | awk '{ print $2}'):on

Find Commands

Find and delete files in  all subdrectories , but don't  delete the directories 

]find /smtp-relay/queue/ -type f -delete

find files more than  3 months old

find /path/to/directory -type f -mtime +90 -delete

find /var/lib/columnstore/data/archived/2024/ -type d -mtime +1

find /var/log/mdriver/ -name "*.erro" -mtime +45 

find /smtp-relay/queue/gwsd/ -type f -mmin +10 -exec echo {} \; -exec grep -E 'X-USANET-Received:|MAIL From|RCPT To|Subject: |ESMTP id |X-USANET-MsgId: |Date' {} \; -exec echo '*******************************************************************************' \;

  
**

